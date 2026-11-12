#!/bin/sh
# Device-free media proof. Does not exercise WebKit, ICE negotiation or TURN.
set -eu
missing=0
for tool in gst-inspect-1.0 gst-launch-1.0 timeout; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Linux voice prerequisite missing: $tool" >&2
        missing=1
    fi
done
if [ "$missing" -ne 0 ]; then
    echo 'Install GStreamer tools, base/good/bad plugins, libnice, and coreutils for your distribution.' >&2
    exit 1
fi
for element in webrtcbin nicesrc nicesink dtlssrtpenc dtlssrtpdec srtpenc srtpdec opusenc opusdec rtpopuspay rtpopusdepay rtpbin; do
    timeout 10 gst-inspect-1.0 "$element" >/dev/null 2>&1 || {
        echo "Linux voice GStreamer element unavailable: $element" >&2
        missing=1
    }
done
if [ "$missing" -ne 0 ]; then
    echo 'Linux desktop development uses the host GStreamer plugins; installer dependencies do not install them for tauri dev.' >&2
    echo 'Arch/Omarchy: sudo pacman -S --needed gst-plugins-base gst-plugins-good gst-plugins-bad libnice' >&2
    echo 'Debian/Ubuntu: sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-base gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-nice' >&2
    echo 'Restart the desktop app after installing the missing plugins.' >&2
    exit 1
fi
# Actually load and run the Opus/RTP path; no microphone, speaker or network.
timeout 20 gst-launch-1.0 -q audiotestsrc num-buffers=20 ! \
    audioconvert ! audioresample ! opusenc ! rtpopuspay ! \
    rtpopusdepay ! opusdec ! fakesink sync=false
printf '%s\n' 'Linux voice media factories and Opus/RTP round trip available; WebKit browser WebRTC capability is a separate check'
