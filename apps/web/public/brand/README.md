# Access spire assets

Current UI usage and visual rules: [DESIGN.md](../../../../DESIGN.md) and
[UI.md](../../UI.md).

Sources: the supplied `Logo system/Brand guidelines.pdf` (October 2026),
`1  PRIMARY HORIZONTAL.png`, and these Figma references:

- [Logo system](https://www.figma.com/design/FEhbQ0cMnzcStGfBK1K2pb/Untitled?node-id=19-27)
- [Sized assets](https://www.figma.com/design/FEhbQ0cMnzcStGfBK1K2pb/Untitled?node-id=20-294)

The SVGs retain the PDF's original spire and Geist Semibold letter outlines.
Their view boxes include the required clear space. The UI uses black in light
mode and white in dark mode. Do not stretch, outline, recolor or add effects.
The horizontal logo renders at a wordmark cap height above the 24px minimum;
use the standalone mark for compact placements.

`apps/desktop/app-icon.svg` uses the square black tile and white spire from
Figma's `app-icon-1024` design. Regenerate native icons from the repository root:

```sh
pnpm --filter @ams/desktop exec tauri icon app-icon.svg
```

The browser icon and Apple touch icon use the same desktop artwork.

`access-wordmark.svg` isolates the unchanged Geist letter path from
`access-logo.svg` for the stacked startup composition. `StartupAnimation.tsx`
references the supplied `Logo system/Startup_animation.mp4` and keeps its
monochrome mark/wordmark/tagline, with growth anchored at the top of the spire.
The MP4 itself is not bundled in the app.

Windows embeds `src-tauri/icons/icon.ico` in the app executable. `build.rs`
tracks that file so icon-only updates invalidate Cargo's cached resource.
NSIS installer/uninstaller icons explicitly use the same ICO; MSI uses the
bundle icon and MSIX copies the generated Store/Square PNGs. Rebuild installers
after regenerating artwork: existing EXE/MSI/MSIX files retain their old icons.
