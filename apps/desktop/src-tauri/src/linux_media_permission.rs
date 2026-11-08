//! Linux media grants within the app webview's navigation/CSP boundary.
//!
//! WebKitGTK 2.22 exposes no requesting-frame origin. The URI below is the
//! top-level URI, not proof of a requesting frame's origin. Keep the existing
//! navigation restriction and frame CSP in place when using this policy.
use tauri::Url;

pub(crate) fn should_allow(
    request_type: &str,
    media_devices: Option<(bool, bool)>,
    top_level_uri: Option<&str>,
    dev_url: Option<&Url>,
) -> bool {
    // DeviceInfoPermissionRequest is available starting with WebKitGTK 2.24.
    // Compare its exact runtime GType name to preserve enumeration on newer
    // engines without linking a 2.24 symbol or raising the 2.22 minimum.
    let supported = match request_type {
        "WebKitUserMediaPermissionRequest" => {
            media_devices.is_some_and(|(audio, video)| audio || video)
        }
        "WebKitDeviceInfoPermissionRequest" => true,
        _ => false,
    };
    if !supported {
        return false;
    }
    let Some(uri) = top_level_uri else {
        return false;
    };
    if uri
        .chars()
        .any(|c| c.is_control() || c.is_whitespace() || c == '\\')
    {
        return false;
    }
    let Some((_, rest)) = uri.split_once("://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or_default();
    if authority.is_empty() || authority.contains(['@', '%']) {
        return false;
    }
    let Ok(url) = Url::parse(uri) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    if url.scheme() == "tauri" && url.host_str() == Some("localhost") && url.port().is_none() {
        return true;
    }
    cfg!(debug_assertions)
        && matches!(url.scheme(), "http" | "https")
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
    fn grants_capture_and_device_enumeration_only() {
        for devices in [Some((true, false)), Some((false, true)), Some((true, true))] {
            assert!(should_allow(
                "WebKitUserMediaPermissionRequest",
                devices,
                Some("tauri://localhost/contest"),
                None
            ));
        }
        assert!(should_allow(
            "WebKitDeviceInfoPermissionRequest",
            None,
            Some("tauri://localhost"),
            None
        ));
        for (kind, devices) in [
            ("WebKitUserMediaPermissionRequest", Some((false, false))),
            ("WebKitUserMediaPermissionRequest", None),
            ("WebKitGeolocationPermissionRequest", Some((true, true))),
            ("WebKitNotificationPermissionRequest", None),
            ("WebKitDeviceInfoPermissionRequestFake", None),
            ("", None),
        ] {
            assert!(!should_allow(
                kind,
                devices,
                Some("tauri://localhost"),
                None
            ));
        }
    }

    #[test]
    fn fails_closed_for_missing_untrusted_or_malformed_top_level_uri() {
        for uri in [
            None,
            Some(""),
            Some("https://example.com"),
            Some("http://tauri.localhost"),
            Some("tauri://localhost:123"),
            Some("tauri://user@localhost"),
            Some("tauri://%6cocalhost"),
            Some("tauri://localhost.evil"),
            Some("tauri:///localhost"),
            Some(" tauri://localhost"),
            Some("tauri://localhost\n"),
            Some("tauri://localhost\\evil"),
            Some("data:text/html,test"),
        ] {
            assert!(
                !should_allow("WebKitDeviceInfoPermissionRequest", None, uri, None),
                "{uri:?}"
            );
        }
    }

    #[test]
    fn development_origin_is_exact_and_debug_only() {
        let dev = Url::parse("http://localhost:3000").unwrap();
        assert_eq!(
            should_allow(
                "WebKitDeviceInfoPermissionRequest",
                None,
                Some("http://localhost:3000/contest"),
                Some(&dev)
            ),
            cfg!(debug_assertions)
        );
        for uri in [
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "https://localhost:3000",
            "http://user@localhost:3000",
        ] {
            assert!(!should_allow(
                "WebKitDeviceInfoPermissionRequest",
                None,
                Some(uri),
                Some(&dev)
            ));
        }
    }
}
