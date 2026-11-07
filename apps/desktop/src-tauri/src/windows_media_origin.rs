//! Requesting-origin boundary for Windows camera and microphone grants.
use tauri::Url;

pub(crate) fn is_allowed_media_origin(request_uri: &str, dev_url: Option<&Url>) -> bool {
    // Reject URL-parser repairs and encoded/userinfo authority tricks before
    // normalization. Paths, queries and fragments do not affect the origin.
    if request_uri
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return false;
    }
    let Some((_, rest)) = request_uri.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains(['@', '%']) {
        return false;
    }
    let Ok(url) = Url::parse(request_uri) else {
        return false;
    };
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return false;
    }
    // tauri.conf.json's Windows window uses the default HTTP custom scheme;
    // HTTPS is a distinct origin and is deliberately not implicitly trusted.
    if url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none() {
        return true;
    }
    cfg!(debug_assertions)
        && dev_url.is_some_and(|dev| {
            matches!(dev.scheme(), "http" | "https")
                && dev.username().is_empty()
                && dev.password().is_none()
                && url.origin() == dev.origin()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_origin_routes_and_equivalent_default_port() {
        for uri in [
            "http://tauri.localhost",
            "http://tauri.localhost/contest?x=1#camera",
            "http://TAURI.LOCALHOST:80/",
        ] {
            assert!(is_allowed_media_origin(uri, None), "{uri}");
        }
    }

    #[test]
    fn rejects_untrusted_and_malformed_requesters() {
        for uri in [
            "",
            "tauri://localhost/",
            "https://tauri.localhost/",
            "http://tauri.localhost:81/",
            "http://tauri.localhost.evil.test/",
            "http://evil.test/tauri.localhost",
            "http://tauri.localhost@evil.test/",
            "http://evil@tauri.localhost/",
            "http://@tauri.localhost/",
            "http://user:secret@tauri.localhost/",
            "http://tauri.localhost./",
            "http://%74auri.localhost/",
            "http:///tauri.localhost/",
            "http:tauri.localhost",
            " http://tauri.localhost/",
            "http://tauri.localhost/\n",
            "http://tauri.localhost\\@evil.test/",
            "blob:http://tauri.localhost/id",
            "data:text/html,hello",
            "http://[::1",
            "http://localhost:3000/",
        ] {
            assert!(!is_allowed_media_origin(uri, None), "{uri}");
        }
    }

    #[test]
    fn development_origin_is_exact_and_debug_only() {
        let dev = Url::parse("http://localhost:3000/path").unwrap();
        assert_eq!(
            is_allowed_media_origin("http://localhost:3000/other", Some(&dev)),
            cfg!(debug_assertions)
        );
        for uri in [
            "http://localhost:3001/",
            "https://localhost:3000/",
            "http://127.0.0.1:3000/",
            "http://localhost:3000.evil.test/",
            "http://user@localhost:3000/",
        ] {
            assert!(!is_allowed_media_origin(uri, Some(&dev)), "{uri}");
        }
        let credentialed = Url::parse("http://user@localhost:3000/").unwrap();
        assert!(!is_allowed_media_origin(
            "http://localhost:3000/",
            Some(&credentialed)
        ));
    }
}
