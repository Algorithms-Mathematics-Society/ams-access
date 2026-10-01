# Contest workspace tools: WebKit verification

Production verification passed: **32 captures**, WebKitGTK 2.52.6, isolated export `/tmp/ams-web-review-qHGFRu/apps/web/out`, served locally at `http://127.0.0.1:4328`. See [results](production/results.json) and [runner](verify.py).

Sizes: 1280×800 (dark and light preference), 1024×600, 390×844, and 320×640. Every case checks the workspace, Workspace menu, editor preferences, scrolled preferences with the Reset button hit-tested, support dialog, and finish review; narrow cases additionally reveal the editor through its scrollable ancestor. Checks cover viewport-contained menus/dialogs, editor area, one main landmark, retained dark theme, draft/submission labels, active-file scope, dialog focus, and absence of horizontal page overflow, external resources, runtime errors, console errors, or hydration errors.

Independently inspected production desktop workspace, 320 px Workspace menu and closed workspace, and 1024×600 editor preferences. Metadata and personal marks stay grouped with the problem; judge status remains separate. The preferences panel uses viewport-bounded placement and scrolls at short heights. Bottom-area and Reset-button hit tests confirm it is not clipped or obscured by the workspace/footer. The final 320 px scrolled preferences capture was also visually inspected. The narrow header wraps its actions while keeping all controls reachable.

These are browser fixtures with media requests held pending and permissions denied. They do not exercise real backend availability, physical camera behavior, native lockdown, or actual contest submission. Chrome tests provide interaction coverage for resize, persistence, marks, source/result attribution, and preferences.

Reproduce after serving the isolated export locally:

```sh
WEBKIT_DISABLE_COMPOSITING_MODE=1 /usr/bin/python3 apps/web/contest-ui/tools/native/verify.py http://127.0.0.1:4328
```
