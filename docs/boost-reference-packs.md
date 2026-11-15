# Offline Boost reference packs

Boost articles are optional. The desktop app checks `GET /reference-packs/boost/latest` once at launch, after the startup animation. A 404 means no pack is published and no download offer appears. This is the current state: the selected Boost topics and production content have not been chosen or published.

## Prepare a pack

Curate reviewed HTML pages in a directory rooted at `boost/`. Include `boost/index.html` and link it to the selected articles with relative `.html` links. The builder does not fetch the upstream site or choose topics:

```sh
node apps/web/scripts/build-boost-reference.mjs /path/to/curated-html /path/to/output boost-1 "Boost reference"
```

The output has `latest.json` plus `boost-1/index.json` and numbered Brotli blocks. `latest.json` contains each asset's SHA-256 and byte length. Review the chosen content and its distribution license before publishing. Do not copy upstream scripts, stylesheets, tracking, or remote assets; the app strips active markup, images, and external navigation at read time. It uses only its local cache during contests.

Set `AMS_BOOST_REFERENCE_PACK_DIR` on the API server to the output directory. Publish a new release by copying its complete immutable release directory first, then replacing `latest.json` atomically. Keep the previous release directory until active downloads of it have ended. The API serves only files listed in the current manifest; clients downloading during a publication change will fail safely and can retry. Do not mutate the bytes of a published release.

The native client accepts the production API origin only in release builds. It limits the manifest to 64 KiB, each file to 8 MiB, a pack to 128 MiB and 32 blocks; it verifies checksums and Brotli output before switching the active local pack. A canceled, interrupted, or invalid update leaves the previous active pack available. Local cache files are reverified before a pack is reported installed, and read assets are checked again. Old versions and staging directories are pruned after successful installation. The same C++ reference panel shows a Boost tab only after a local pack is present.

## Fixture checks

The two-page fixture under `apps/web/scripts/fixtures/boost-reference` exercises the pack format. Run:

```sh
node --test apps/web/scripts/build-boost-reference.test.mjs
cargo test -p ams-access --lib boost_reference --no-default-features
```

In `ams-api`, run `.venv/bin/pytest -q tests/test_reference_packs.py` and `.venv/bin/ruff check src/ams_api/api/routes/reference_packs.py tests/test_reference_packs.py`. The API tests use direct route functions to avoid database setup. Before enabling the pack for candidates, verify download and offline browsing on an installed Windows, macOS, and Linux build, including cancellation, interrupted download, and a valid old pack. At 3,000 simultaneous launches, the offer causes up to 3,000 manifest GETs. If every candidate chooses Download, the 32-block limit bounds the pack traffic at 102,000 static GETs (manifest, index, blocks), with no automatic retry. Verify this burst against the staging server and its reverse proxy before publishing.
