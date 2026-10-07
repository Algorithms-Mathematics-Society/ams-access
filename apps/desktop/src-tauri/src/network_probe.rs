//! Bounded checks of the configured exam endpoint. DNS resolution is not proof
//! of reachability, and an unrelated public host must never replace its result.
use core_rs::exam::NetworkCheckResult;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const MAX_PROBES: usize = 4;
const MAX_DNS_WORKERS: usize = 2;
const MAX_ADDRESSES: usize = 4;
const DNS_TIMEOUT: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT: Duration = Duration::from_millis(1500);
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
static PROBES: AtomicUsize = AtomicUsize::new(0);
static DNS_WORKERS: AtomicUsize = AtomicUsize::new(0);

struct Permit<'a>(&'a AtomicUsize);
impl<'a> Permit<'a> {
    fn acquire(counter: &'a AtomicUsize, maximum: usize) -> Option<Self> {
        let mut active = counter.load(Ordering::Acquire);
        while active < maximum {
            match counter.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some(Self(counter)),
                Err(current) => active = current,
            }
        }
        None
    }
}
impl Drop for Permit<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Target {
    Address(SocketAddr),
    Host { host: String, port: u16 },
}

fn url_target(value: &str) -> Option<Target> {
    let url = reqwest::Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }
    // URL's IPv6 host serialization includes brackets; parse the bare IP
    // to avoid a DNS worker for literal addresses.
    let host = url.host_str()?.trim_matches(['[', ']']);
    let port = url.port_or_known_default()?;
    Some(match host.parse::<IpAddr>() {
        Ok(ip) => Target::Address(SocketAddr::new(ip, port)),
        Err(_) => Target::Host {
            host: host.to_string(),
            port,
        },
    })
}

fn target(host: &str, api_url: Option<&str>) -> Option<Target> {
    if let Some(api) = api_url.map(str::trim).filter(|value| !value.is_empty()) {
        return url_target(api);
    }
    let host = host.trim();
    if host.is_empty() {
        return None;
    }
    if let Ok(address) = host.parse::<SocketAddr>() {
        // Keep the full socket address: converting an IPv6 address to just
        // its IP and port loses the scope ID required by link-local targets.
        return Some(Target::Address(address));
    }
    if let Ok(ip) = host.trim_matches(['[', ']']).parse::<IpAddr>() {
        return Some(Target::Address(SocketAddr::new(ip, 443)));
    }
    if host.contains("://") {
        url_target(host)
    } else {
        // Host strings are authorities, not arbitrary URL paths or user-info.
        if host.contains(['/', '?', '#', '@']) {
            return None;
        }
        url_target(&format!("https://{host}"))
    }
}

/// Keep both families represented even when the resolver groups all IPv6
/// addresses first. Bound the number of sockets per sample and remove repeats.
fn bounded_addresses(addresses: impl IntoIterator<Item = SocketAddr>) -> Vec<SocketAddr> {
    let mut v4 = Vec::new();
    let mut v6 = Vec::new();
    // The system resolver returns an owned address list. Limit iteration too,
    // rather than collecting an arbitrary iterator before bounding the output.
    for address in addresses.into_iter().take(64) {
        let family = if address.is_ipv4() { &mut v4 } else { &mut v6 };
        if family.len() < MAX_ADDRESSES && !family.contains(&address) {
            family.push(address);
        }
    }
    let mut selected = Vec::with_capacity(MAX_ADDRESSES);
    for index in 0..MAX_ADDRESSES {
        for address in [v6.get(index), v4.get(index)].into_iter().flatten() {
            if selected.len() < MAX_ADDRESSES {
                selected.push(*address);
            }
        }
    }
    selected
}

async fn bounded_dns_worker(
    workers: &'static AtomicUsize,
    maximum: usize,
    timeout: Duration,
    resolve: impl FnOnce() -> Option<Vec<SocketAddr>> + Send + 'static,
) -> Option<Vec<SocketAddr>> {
    let permit = Permit::acquire(workers, maximum)?;
    // The permit belongs to the actual blocking job, not its async waiter.
    // DNS cannot be cancelled portably. A timed-out/abandoned waiter therefore
    // cannot cause the next caller to queue unlimited resolver jobs.
    tokio::time::timeout(
        timeout,
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            resolve()
        }),
    )
    .await
    .ok()?
    .ok()?
}

async fn resolve(target: Target) -> Option<Vec<SocketAddr>> {
    match target {
        Target::Address(address) => Some(vec![address]),
        Target::Host { host, port } => {
            bounded_dns_worker(&DNS_WORKERS, MAX_DNS_WORKERS, DNS_TIMEOUT, move || {
                (host.as_str(), port)
                    .to_socket_addrs()
                    .map(bounded_addresses)
                    .ok()
            })
            .await
        }
    }
}

async fn sample(addresses: &[SocketAddr]) -> Option<u64> {
    let mut attempts = tokio::task::JoinSet::new();
    for &address in addresses.iter().take(MAX_ADDRESSES) {
        attempts.spawn(async move {
            let started = Instant::now();
            match tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(address))
                .await
            {
                Ok(Ok(stream)) => {
                    drop(stream);
                    Some(started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64)
                }
                _ => None,
            }
        });
    }
    while let Some(result) = attempts.join_next().await {
        if let Ok(Some(elapsed)) = result {
            // Dropping JoinSet cancels remaining socket attempts, including
            // when the outer probe is itself cancelled or times out.
            return Some(elapsed);
        }
    }
    None
}

fn result(samples: &[u64]) -> NetworkCheckResult {
    if samples.is_empty() {
        return NetworkCheckResult {
            reachable: false,
            latency_ms: None,
            jitter_ms: None,
            quality: "unreachable".into(),
            clock_skew_ms: None,
        };
    }
    let latency_ms = samples.iter().map(|&n| u128::from(n)).sum::<u128>() / samples.len() as u128;
    let latency_ms = latency_ms.min(u128::from(u64::MAX)) as u64;
    let jitter_ms = (samples.len() >= 2).then(|| {
        let total = samples
            .windows(2)
            .map(|pair| u128::from(pair[0].abs_diff(pair[1])))
            .sum::<u128>();
        (total / (samples.len() - 1) as u128).min(u128::from(u64::MAX)) as u64
    });
    NetworkCheckResult {
        reachable: true,
        latency_ms: Some(latency_ms),
        jitter_ms,
        quality: match latency_ms {
            0..=80 => "excellent",
            81..=200 => "good",
            201..=1000 => "fair",
            _ => "poor",
        }
        .into(),
        // Only the root's pinned HTTP Date-header probe may populate this.
        clock_skew_ms: None,
    }
}

async fn probe(target: Target) -> NetworkCheckResult {
    let Some(addresses) = resolve(target).await else {
        return result(&[]);
    };
    let mut samples = Vec::with_capacity(2);
    for _ in 0..2 {
        if let Some(elapsed) = sample(&addresses).await {
            samples.push(elapsed);
        }
    }
    result(&samples)
}

pub(crate) async fn check(host: String, api_url: Option<String>) -> NetworkCheckResult {
    let Some(target) = target(&host, api_url.as_deref()) else {
        return result(&[]);
    };
    let Some(_permit) = Permit::acquire(&PROBES, MAX_PROBES) else {
        // No measurement was made. The unchanged IPC shape has no distinct
        // pending/error field; "unknown" keeps this separate from a failed TCP
        // attempt while reachable remains false until proven by a connection.
        let mut unknown = result(&[]);
        unknown.quality = "unknown".into();
        return unknown;
    };
    tokio::time::timeout(PROBE_TIMEOUT, probe(target))
        .await
        .unwrap_or_else(|_| result(&[]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_url_is_authoritative_and_keeps_explicit_development_port() {
        assert_eq!(
            target("unrelated.example", Some("http://localhost:3001/api")),
            Some(Target::Host {
                host: "localhost".into(),
                port: 3001
            })
        );
        assert_eq!(
            target("example.test", Some("https://[::1]:8443/api")),
            Some(Target::Address("[::1]:8443".parse().unwrap()))
        );
        assert_eq!(
            target("example.test", Some("https://api.example.test")),
            Some(Target::Host {
                host: "api.example.test".into(),
                port: 443
            })
        );
        assert!(target("working.example", Some("not-a-url")).is_none());
        assert!(target("working.example", Some("file:///tmp/data")).is_none());
    }

    #[test]
    fn bare_hosts_socket_addresses_and_ipv6_are_parsed_without_fake_success() {
        for (host, expected) in [
            (
                "localhost:8123",
                Target::Host {
                    host: "localhost".into(),
                    port: 8123,
                },
            ),
            ("[::1]:8123", Target::Address("[::1]:8123".parse().unwrap())),
            ("::1", Target::Address("[::1]:443".parse().unwrap())),
            (
                "127.0.0.1",
                Target::Address("127.0.0.1:443".parse().unwrap()),
            ),
            (
                "https://example.test:8443",
                Target::Host {
                    host: "example.test".into(),
                    port: 8443,
                },
            ),
        ] {
            assert_eq!(target(host, None), Some(expected));
        }
        for host in [
            "",
            " ",
            "example.test/path",
            "me@example.test",
            "https://me:secret@example.test",
        ] {
            assert!(target(host, None).is_none());
        }
    }

    #[test]
    fn scoped_ipv6_socket_address_keeps_its_interface_during_resolution() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let address: SocketAddr = "[fe80::1%3]:8123".parse().unwrap();
        let parsed = target(&address.to_string(), None).unwrap();
        assert_eq!(runtime.block_on(resolve(parsed)), Some(vec![address]));
    }

    #[test]
    fn address_limit_preserves_both_families_and_removes_duplicates() {
        let addresses = [
            "[::1]:443",
            "[::1]:443",
            "[::2]:443",
            "[::3]:443",
            "[::4]:443",
            "127.0.0.1:443",
            "127.0.0.2:443",
        ];
        let selected = bounded_addresses(addresses.map(|s| s.parse().unwrap()));
        assert_eq!(selected.len(), 4);
        assert_eq!(selected.iter().filter(|a| a.is_ipv4()).count(), 2);
        assert_eq!(selected.iter().filter(|a| a.is_ipv6()).count(), 2);
    }

    #[test]
    fn jitter_is_measured_and_absent_when_only_one_sample_succeeded() {
        assert!(!result(&[]).reachable);
        assert_eq!(result(&[]).jitter_ms, None);
        assert_eq!(result(&[17]).jitter_ms, None);
        let measured = result(&[20, 80]);
        assert_eq!(measured.latency_ms, Some(50));
        assert_eq!(measured.jitter_ms, Some(60));
        assert_eq!(measured.clock_skew_ms, None);
        assert_eq!(result(&[u64::MAX, u64::MAX]).latency_ms, Some(u64::MAX));
    }

    #[test]
    fn capacity_limits_are_held_until_actual_worker_finishes() {
        let counter = AtomicUsize::new(0);
        let first = Permit::acquire(&counter, 2).unwrap();
        let second = Permit::acquire(&counter, 2).unwrap();
        assert!(Permit::acquire(&counter, 2).is_none());
        drop(first);
        assert_eq!(counter.load(Ordering::Acquire), 1);
        let third = Permit::acquire(&counter, 2).unwrap();
        drop(second);
        drop(third);
        assert_eq!(counter.load(Ordering::Acquire), 0);
    }

    #[test]
    fn timed_out_dns_work_retains_capacity_until_it_actually_finishes() {
        static WORKERS: AtomicUsize = AtomicUsize::new(0);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (release, wait) = std::sync::mpsc::channel::<()>();
            let result = bounded_dns_worker(&WORKERS, 1, Duration::from_millis(20), move || {
                wait.recv_timeout(Duration::from_secs(2)).unwrap();
                Some(Vec::new())
            })
            .await;
            assert!(result.is_none());
            assert_eq!(WORKERS.load(Ordering::Acquire), 1);
            assert!(
                bounded_dns_worker(&WORKERS, 1, Duration::from_millis(20), || panic!(
                    "no worker should be queued"
                ))
                .await
                .is_none()
            );
            release.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while WORKERS.load(Ordering::Acquire) != 0 {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await
            .unwrap();
            assert!(
                bounded_dns_worker(&WORKERS, 1, Duration::from_millis(100), || Some(Vec::new()))
                    .await
                    .is_some()
            );
        });
    }

    #[test]
    fn cancelled_dns_waiter_retains_capacity_until_worker_finishes() {
        static WORKERS: AtomicUsize = AtomicUsize::new(0);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let (release, wait) = std::sync::mpsc::channel::<()>();
            let (started, worker_started) = tokio::sync::oneshot::channel();
            let waiter = tokio::spawn(bounded_dns_worker(
                &WORKERS,
                1,
                Duration::from_secs(2),
                move || {
                    started.send(()).unwrap();
                    wait.recv_timeout(Duration::from_secs(2)).unwrap();
                    Some(Vec::new())
                },
            ));
            tokio::time::timeout(Duration::from_secs(1), worker_started)
                .await
                .unwrap()
                .unwrap();
            waiter.abort();
            assert!(waiter.await.unwrap_err().is_cancelled());
            assert_eq!(WORKERS.load(Ordering::Acquire), 1);
            assert!(
                bounded_dns_worker(&WORKERS, 1, Duration::from_millis(20), || panic!(
                    "cancelled waiters must not free a running worker's capacity"
                ))
                .await
                .is_none()
            );
            release.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(1), async {
                while WORKERS.load(Ordering::Acquire) != 0 {
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
            })
            .await
            .unwrap();
            assert!(
                bounded_dns_worker(&WORKERS, 1, Duration::from_millis(100), || Some(Vec::new()))
                    .await
                    .is_some()
            );
        });
    }

    #[test]
    fn failed_address_does_not_hide_a_reachable_alternate_family() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addresses = ["[::1]:0".parse().unwrap(), listener.local_addr().unwrap()];
            assert!(sample(&addresses).await.is_some());
            assert_eq!(sample(&[]).await, None);
            drop(listener);
            assert_eq!(sample(&addresses).await, None);
        });
    }

    #[test]
    fn localhost_requires_a_real_connection_on_the_configured_port() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let live = check(
                "unrelated.invalid".into(),
                Some(format!("http://{address}/api")),
            )
            .await;
            assert!(live.reachable);
            assert!(live.jitter_ms.is_some());
            assert_eq!(live.clock_skew_ms, None);
            drop(listener);
            let closed = check(address.to_string(), None).await;
            assert!(!closed.reachable);
            assert_eq!(closed.latency_ms, None);
            assert_eq!(closed.jitter_ms, None);
        });
    }
}
