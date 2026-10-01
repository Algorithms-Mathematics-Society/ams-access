# First-batch WebKit verification

Accepted production run: [results.json](production/results.json), WebKitGTK 2.52.6, exported build `/tmp/ams-web-review-5usCDT/apps/web/out`, served at `http://127.0.0.1:4327`.

All 13 captures pass across 1280×800 (dark and light preference), 1024×600, and 390×844. The contest retains its dark theme. Checks cover workspace rendering, narrow editor scrolling, support and finish-review dialogs, focus entering dialogs, viewport-contained overlays, draft/submission distinction, active-file scope, one main landmark, no horizontal overflow, and no runtime, console, or hydration errors.

The desktop workspace, short workspace, and narrow finish review were visually inspected. At 1024×600 the editor shows roughly six lines (124px viewport) with output expanded; the existing output-collapse control remains available to reclaim editor space. At 390px the editor has a user-scrollable ancestor and can be revealed inside the viewport. This pass changes no application layout.

These are synthetic browser fixtures. Media requests stay pending and permission requests are denied. No real camera, backend service, native bridge, support delivery, or contest completion is exercised. Chrome interaction tests provide the separate behavioral evidence for those frontend branches.

Run with an isolated export served locally:

```sh
WEBKIT_DISABLE_COMPOSITING_MODE=1 /usr/bin/python3 apps/web/contest-ui/confidence/native/verify.py http://127.0.0.1:4327
```
