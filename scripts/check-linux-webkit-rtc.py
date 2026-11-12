#!/usr/bin/env python3
"""Device-free WebKitGTK RTC/Opus offer probe. Requires a desktop session and PyGObject.

No camera, microphone, signaling, STUN, or TURN access. Does not prove a live call.
"""

import json
import sys

try:
    import gi

    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import GLib, Gtk, WebKit2
except (ImportError, ValueError) as error:
    sys.exit(f"WebKit RTC probe requires Python PyGObject and WebKit2 4.1 introspection: {error}")

if not Gtk.init_check()[0]:
    sys.exit("WebKit RTC probe requires access to the active desktop display.")

window = Gtk.Window(title="AMS Access — local WebKit RTC check")
window.set_default_size(480, 120)
view = WebKit2.WebView()
settings = view.get_settings()
if not settings.find_property("enable-webrtc"):
    sys.exit("Installed WebKitGTK has no enable-webrtc setting (requires WebKitGTK 2.38+).")
settings.set_property("enable-webrtc", True)
exit_code = 1


def finish(message, success=False):
    global exit_code
    print(message, flush=True)
    exit_code = 0 if success else 1
    Gtk.main_quit()


def evaluated(webview, result, _data):
    try:
        value = json.loads(webview.call_async_javascript_function_finish(result).to_string())
        print(json.dumps(value, sort_keys=True), flush=True)
        if value.get("rtc") != "function":
            finish(
                "RTCPeerConnection is unavailable even with enable-webrtc=True. "
                "The installed WebKit must include WebRTC support; GStreamer plugins alone are insufficient. "
                "Upstream WebKitGTK 2.54 disables WebRTC during its backend transition."
            )
            return
        success = value.get("opusOffer", False)
        finish(
            "WebKitGTK can create a local Opus audio offer. Live ICE/TURN and device access remain untested."
            if success else "WebKitGTK exposes RTC but cannot create an Opus offer. Check its codec/backend support.",
            success=success,
        )
    except Exception as error:
        finish(f"WebKitGTK RTC probe failed: {error}")


def loaded(webview, event):
    if event != WebKit2.LoadEvent.FINISHED:
        return
    webview.call_async_javascript_function(
        """
        const diagnostics = {
          secure: isSecureContext,
          rtc: typeof RTCPeerConnection,
          mediaDevices: typeof navigator.mediaDevices,
          opusOffer: false
        };
        if (diagnostics.rtc !== 'function') return JSON.stringify(diagnostics);
        const peer = new RTCPeerConnection({iceServers: []});
        try {
          peer.addTransceiver('audio');
          const offer = await peer.createOffer();
          diagnostics.opusOffer = /a=rtpmap:\\d+ opus\\/48000/i.test(offer.sdp);
          return JSON.stringify(diagnostics);
        } finally {
          peer.close();
        }
        """,
        -1, None, None, None, None, evaluated, None,
    )


print(
    f"WebKitGTK {WebKit2.get_major_version()}.{WebKit2.get_minor_version()}.{WebKit2.get_micro_version()}, "
    f"enable-webrtc={settings.get_property('enable-webrtc')}",
    flush=True,
)
if not hasattr(view, "call_async_javascript_function"):
    sys.exit("The optional offer probe requires WebKitGTK 2.40+ async JavaScript support.")
view.connect("load-changed", loaded)
window.add(view)
window.show_all()
# Local secure origin; the document and script are supplied in memory.
view.load_html("<p>Checking local WebKit RTC support. No devices or network are used.</p>", "http://localhost:3000/")
GLib.timeout_add_seconds(20, lambda: finish("WebKitGTK RTC probe timed out."))
Gtk.main()
window.destroy()
sys.exit(exit_code)
