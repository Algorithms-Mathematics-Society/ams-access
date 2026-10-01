# Native theme probe

Independent review ran on installed **WebKitGTK 2.52.6** (Ubuntu package `2.52.6-0ubuntu0.24.04.1`) using an ephemeral GTK WebView and software rendering. [results.json](results.json) records computed styles, exact source hashes, and passing assertions; six PNGs show both theme implementations across light, dark, and saved-light plus dark-lock modes.

The input is actual React server-rendered Astryx Theme, Button and TextInput markup. The provider deliberately renders its default `dark` mode in every case, testing that the HTML's effective theme still controls light-mode first paint. Locally bundled Geist fonts are embedded in the fixture, with no network request or participant session. The shared controls remain monochrome except the explicit Submit variant. Legacy Login and Onboarding buttons additionally prove the repaired foreground pairs; disabled semantics, opacity, padding, panel text and shadow were inspected.

The `fallback-only` cases omit the official scoped theme CSS and match modern CSS computed styles exactly. This verifies the adapter path on this engine; it does **not** emulate an older engine's parser or certify macOS/Windows support. A separate standalone capability probe confirmed actual `light-dark()` color resolution, `@scope` isolation, CSS layers, `color-mix()`, and the native dialog API in this installed engine. The fixture does not exercise Tauri commands, media, exam enforcement, React hydration, or live participant requests.

Run from the repository root with Node 24, Python GI and the installed WebKitGTK 4.1 bindings:

```sh
node apps/web/theme-p1/native/render-markup.mjs
WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 LIBGL_ALWAYS_SOFTWARE=1 /usr/bin/python3 apps/web/theme-p1/native/probe.py
```

The environment flags are required because this workspace's offscreen display cannot create an OpenGL context. GTK's offscreen pixbuf captures the images. Native app acceleration and complete desktop flows remain separate checks.
