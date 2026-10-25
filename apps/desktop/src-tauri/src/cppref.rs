//! Native access to the bundled cppreference search index and compressed blocks.

use std::io::{Read, Take};
use tauri::AppHandle;

const MAX_ASSET_BYTES: usize = 8 * 1024 * 1024;

pub(crate) fn is_allowed_name(name: &str) -> bool {
    name == "index.json"
        || (name
            .strip_prefix('b')
            .and_then(|n| n.strip_suffix(".br"))
            .is_some_and(|n| n.len() == 4 && n.bytes().all(|b| b.is_ascii_digit())))
}

fn decode_block(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("cppreference compressed asset exceeds the 8 MiB limit".into());
    }
    let decoder = brotli::Decompressor::new(bytes, 16 * 1024);
    let mut bounded: Take<_> = decoder.take((MAX_ASSET_BYTES + 1) as u64);
    let mut output = Vec::new();
    bounded
        .read_to_end(&mut output)
        .map_err(|e| format!("Unable to decompress cppreference block: {e}"))?;
    if output.len() > MAX_ASSET_BYTES {
        return Err("cppreference decompressed asset exceeds the 8 MiB limit".into());
    }
    Ok(output)
}

fn asset_bytes(app: &AppHandle, name: &str) -> Result<Vec<u8>, String> {
    if !is_allowed_name(name) {
        return Err("Unsupported cppreference asset name".into());
    }
    let path = format!("cppref/{name}");
    let canonical_key = tauri::utils::assets::AssetKey::from(path.as_str());
    // `AssetResolver::get` falls back to index.html for missing paths. Confirm
    // the exact key exists first so an SPA fallback can never masquerade as data.
    let found_exact = app
        .asset_resolver()
        .iter()
        .any(|(key, _)| key.as_ref() == canonical_key.as_ref());
    if !found_exact {
        return Err(
            "cppreference bundle is missing; rebuild the desktop app with the reference bundle"
                .into(),
        );
    }
    let asset = app.asset_resolver().get(path).ok_or_else(|| {
        "cppreference bundle is missing; rebuild the desktop app with the reference bundle"
            .to_string()
    })?;
    if asset.bytes.len() > MAX_ASSET_BYTES {
        return Err("cppreference asset exceeds the 8 MiB limit".into());
    }
    if name == "index.json" {
        // Catch accidental HTML fallback or an incorrectly packed index early.
        serde_json::from_slice::<serde_json::Value>(&asset.bytes).map_err(|_| {
            "Bundled cppreference index.json is invalid; rebuild the reference bundle".to_string()
        })?;
        Ok(asset.bytes)
    } else {
        decode_block(&asset.bytes)
    }
}

#[tauri::command]
pub(crate) async fn read_cppref_asset(
    app: AppHandle,
    name: String,
) -> Result<tauri::ipc::Response, String> {
    if !is_allowed_name(&name) {
        return Err("Unsupported cppreference asset name".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || asset_bytes(&app, &name))
        .await
        .map_err(|e| format!("Unable to read cppreference bundle: {e}"))??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn allows_only_index_or_four_digit_blocks() {
        for good in ["index.json", "b0000.br", "b0321.br"] {
            assert!(is_allowed_name(good), "{good}");
        }
        for bad in [
            "../index.json",
            "/index.json",
            "b321.br",
            "b00001.br",
            "b12x4.br",
            "index.html",
            "b0000.br/../x",
        ] {
            assert!(!is_allowed_name(bad), "{bad}");
        }
    }

    #[test]
    fn decompresses_brotli_and_rejects_corruption() {
        let mut encoded = Vec::new();
        {
            let mut writer = brotli::CompressorWriter::new(&mut encoded, 4096, 5, 22);
            writer.write_all(b"reference block").unwrap();
        }
        assert_eq!(decode_block(&encoded).unwrap(), b"reference block");
        assert!(decode_block(b"not brotli").is_err());
        let truncated = &encoded[..encoded.len() - 1];
        assert!(decode_block(truncated).is_err());
    }

    #[test]
    fn asset_key_uses_tauri_canonical_rooted_form() {
        let key = tauri::utils::assets::AssetKey::from("cppref/index.json");
        assert_eq!(key.as_ref(), "/cppref/index.json");
        assert_eq!(
            key.as_ref(),
            tauri::utils::assets::AssetKey::from("/cppref/index.json").as_ref()
        );
    }

    #[test]
    fn rejects_oversized_decompressed_output() {
        let input = vec![b'x'; MAX_ASSET_BYTES + 1];
        let mut encoded = Vec::new();
        {
            let mut writer = brotli::CompressorWriter::new(&mut encoded, 4096, 5, 22);
            writer.write_all(&input).unwrap();
        }
        assert!(decode_block(&encoded).unwrap_err().contains("8 MiB limit"));
    }
}
