#!/usr/bin/env python3
"""Device-free native GStreamer WebRTC SDP gate.

Two local peers negotiate synthetic Opus audio. ICE is relay-only, with no TURN
server or candidate exchange, so this does not establish a media connection.
The parent process bounds a stalled GStreamer promise and the worker always
returns its pipelines to NULL on normal completion or failure.
"""

import os
import subprocess
import sys
import tempfile


PIPELINE = (
    "webrtcbin name=rtc bundle-policy=max-bundle ice-transport-policy=relay "
    "audiotestsrc is-live=true wave=silence ! audioconvert ! audioresample ! "
    "opusenc ! rtpopuspay pt=96 ! "
    "application/x-rtp,media=audio,encoding-name=OPUS,payload=96,clock-rate=48000 ! rtc."
)


def require_promise_reply(promise, signal, replied):
    if promise.wait() != replied:
        raise RuntimeError(f"{signal} did not complete")
    reply = promise.get_reply()
    if reply is not None and reply.has_field("error") and reply.get_value("error") is not None:
        raise RuntimeError(f"{signal} returned a GStreamer error")
    return reply


def worker():
    import gi

    gi.require_version("Gst", "1.0")
    gi.require_version("GstWebRTC", "1.0")
    gi.require_version("GstSdp", "1.0")
    from gi.repository import Gst, GstWebRTC, GstSdp  # noqa: F401

    Gst.init(None)
    for factory in ("webrtcbin", "audiotestsrc", "opusenc", "rtpopuspay"):
        if not Gst.ElementFactory.find(factory):
            raise RuntimeError(f"missing GStreamer factory: {factory}")

    pipelines = []

    def peer():
        pipeline = Gst.parse_launch(PIPELINE)
        pipelines.append(pipeline)
        if pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            raise RuntimeError("synthetic pipeline could not start")
        _, state, _ = pipeline.get_state(5 * Gst.SECOND)
        if state != Gst.State.PLAYING:
            raise RuntimeError("synthetic pipeline did not reach PLAYING")
        return pipeline.get_by_name("rtc")

    def operation(rtc, signal, *args):
        promise = Gst.Promise.new()
        rtc.emit(signal, *args, promise)
        require_promise_reply(promise, signal, Gst.PromiseResult.REPLIED)
        return promise

    def description(promise, field):
        # Keep the Gst.Structure alive while reading the boxed description.
        # Dropping the temporary reply first can crash PyGObject.
        reply = promise.get_reply()
        if reply is None:
            raise RuntimeError(f"missing {field} reply")
        result = reply.get_value(field)
        if result is None:
            raise RuntimeError(f"missing {field} SDP")
        return result, reply

    def check_audio_sdp(description_value, label):
        lines = description_value.sdp.as_text().splitlines()
        media = [line for line in lines if line.startswith("m=")]
        if len(media) != 1 or not media[0].startswith("m=audio "):
            raise RuntimeError(f"{label} does not contain exactly one audio m-line")
        if "a=sendrecv" not in lines:
            raise RuntimeError(f"{label} is not sendrecv")
        if not any(line.lower().startswith("a=rtpmap:") and "opus/48000" in line.lower() for line in lines):
            raise RuntimeError(f"{label} does not offer Opus/48000")

    try:
        first = peer()
        second = peer()
        offer, offer_reply = description(operation(first, "create-offer", None), "offer")
        check_audio_sdp(offer, "offer")
        operation(first, "set-local-description", offer)
        operation(second, "set-remote-description", offer)
        answer, answer_reply = description(operation(second, "create-answer", None), "answer")
        check_audio_sdp(answer, "answer")
        operation(second, "set-local-description", answer)
        operation(first, "set-remote-description", answer)
        if any(
            rtc.get_property("signaling-state") != GstWebRTC.WebRTCSignalingState.STABLE
            for rtc in (first, second)
        ):
            raise RuntimeError("peers did not reach stable signaling state")
        # Retain boxed SDP and its owner until all description calls finish.
        _ = (offer_reply, answer_reply)
    finally:
        for pipeline in reversed(pipelines):
            pipeline.set_state(Gst.State.NULL)
            _, state, _ = pipeline.get_state(3 * Gst.SECOND)
            if state != Gst.State.NULL:
                raise RuntimeError("synthetic pipeline did not return to NULL")
    print("PASS native GStreamer: two sendrecv Opus SDP peers reached stable signaling and NULL")


def main():
    if sys.argv[1:] == ["--worker"]:
        try:
            worker()
        except Exception as error:
            print(f"FAIL native GStreamer SDP probe: {error}", file=sys.stderr)
            return 1
        return 0
    if sys.argv[1:]:
        print("usage: check-linux-native-rtc.py", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="ams-native-rtc-") as directory:
        env = {**os.environ, "GST_REGISTRY": os.path.join(directory, "registry.bin")}
        try:
            result = subprocess.run(
                [sys.executable, __file__, "--worker"],
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
        except subprocess.TimeoutExpired:
            print("FAIL native GStreamer SDP probe: timed out after 15 seconds", file=sys.stderr)
            return 1
    if result.stdout:
        print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
