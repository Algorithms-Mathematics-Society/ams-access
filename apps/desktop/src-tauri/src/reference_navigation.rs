//! Navigation boundary for the single application webview.
//!
//! Top-level navigations are restricted to the bundled app origin (and the
//! configured development server in debug builds). This is deliberately an
//! origin check: same-origin client routes continue to work, while links to
//! arbitrary sites cannot replace the exam shell.

use tauri::Url;

pub(crate) fn is_allowed_app_navigation(url: &Url, dev_url: Option<&Url>) -> bool {
    // Tauri's production origin depends on the platform's custom protocol.
    // `tauri://localhost` is used by macOS/Linux; Windows commonly uses the
    // secure `https://tauri.localhost` origin.
    let has_no_credentials = url.username().is_empty() && url.password().is_none();
    let bundled_origin = has_no_credentials
        && url.port().is_none()
        && ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
            || (matches!(url.scheme(), "http" | "https")
                && url.host_str() == Some("tauri.localhost")));
    if bundled_origin {
        return true;
    }

    // Keep local frontend development functional without permitting remote
    // hosts or alternative ports.
    cfg!(debug_assertions)
        && has_no_credentials
        && dev_url.is_some_and(|dev_url| url.origin() == dev_url.origin())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_app_navigation;
    use tauri::Url;

    #[test]
    fn allows_only_app_origins_and_configured_dev_server() {
        for allowed in [
            "tauri://localhost/contest/123",
            "http://tauri.localhost/contest/123",
            "https://tauri.localhost/contest/123",
        ] {
            assert!(is_allowed_app_navigation(
                &Url::parse(allowed).unwrap(),
                None
            ));
        }

        let dev_url = Url::parse("http://localhost:3001").unwrap();
        let dev = is_allowed_app_navigation(
            &Url::parse("http://localhost:3001/contest").unwrap(),
            Some(&dev_url),
        );
        assert_eq!(dev, cfg!(debug_assertions));

        for wrong_dev_origin in [
            "http://localhost:3000/contest",
            "http://127.0.0.1:3001/contest",
        ] {
            assert!(
                !is_allowed_app_navigation(&Url::parse(wrong_dev_origin).unwrap(), Some(&dev_url)),
                "{wrong_dev_origin}"
            );
        }

        for denied in [
            "tauri://localhost:123/",
            "tauri://user@localhost/",
            "http://user@tauri.localhost/",
            "http://tauri.localhost:123/",
            "https://example.com/",
            "https://amsaccess.com/",
            "http://localhost:3000/",
            "http://localhost:3001/",
            "http://127.0.0.1:3001/",
            "file:///etc/passwd",
            "javascript:alert(1)",
        ] {
            assert!(
                !is_allowed_app_navigation(&Url::parse(denied).unwrap(), None),
                "{denied}"
            );
        }

        // A configured development origin is exact: candidate credentials
        // cannot be smuggled into an otherwise matching localhost origin.
        let credentialed = Url::parse("http://user@localhost:3001/contest").unwrap();
        assert!(!is_allowed_app_navigation(&credentialed, Some(&dev_url)));
    }
}
