#!/bin/sh
# Read-only prerequisites for the configured AppImage media build.
set -eu
missing=0
for tool in patchelf gst-inspect-1.0 glib-compile-schemas; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Linux packaging prerequisite missing: $tool" >&2
        missing=1
    fi
done
[ "$missing" -eq 0 ] || exit 1
for plugin in v4l2src videoconvert audioconvert; do
    gst-inspect-1.0 "$plugin" >/dev/null || {
        echo "Linux packaging GStreamer plugin unavailable: $plugin (install base/good plugins in the builder)" >&2
        exit 1
    }
done
printf '%s\n' 'Linux media packaging prerequisites available'
