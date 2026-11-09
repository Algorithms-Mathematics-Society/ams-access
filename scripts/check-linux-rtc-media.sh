#!/bin/sh
# Device-free media proof. Does not exercise WebKit, ICE negotiation or TURN.
set -eu
for element in webrtcbin nicesrc nicesink dtlssrtpenc dtlssrtpdec srtpenc srtpdec opusenc opusdec rtpopuspay rtpopusdepay rtpbin; do
    gst-inspect-1.0 "$element" >/dev/null || {
        echo "Linux voice GStreamer element unavailable: $element" >&2
        exit 1
    }
done
# Actually load and run the Opus/RTP path; no microphone, speaker or network.
timeout 20 gst-launch-1.0 -q audiotestsrc num-buffers=20 ! \
    audioconvert ! audioresample ! opusenc ! rtpopuspay ! \
    rtpopusdepay ! opusdec ! fakesink sync=false
printf '%s\n' 'Linux voice media factories and Opus/RTP round trip available'
