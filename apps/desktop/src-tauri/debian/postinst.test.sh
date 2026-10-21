#!/bin/sh
# Safe packaging regression checks: a generated copy writes only below a
# temporary root and uses an isolated PATH. Never run the real postinst.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 - "$SCRIPT_DIR/postinst" <<'PY'
from pathlib import Path
import os
import stat
import subprocess
import sys
import tempfile

source = Path(sys.argv[1]).read_text()
with tempfile.TemporaryDirectory(prefix="ams-postinst-review-") as work:
    root = Path(work)
    mock = root / "bin"
    mock.mkdir()

    # Only the generated fixture sees this path. The source script is never
    # invoked, and every absolute package path is redirected below root.
    fixture = source
    for old, new in (
        ("/etc/", str(root / "etc") + "/"),
        ("/run/", str(root / "run") + "/"),
    ):
        fixture = fixture.replace(old, new)
    script = root / "postinst"
    script.write_text(fixture)
    script.chmod(0o755)

    for name in ("cat", "chmod", "dirname", "mkdir"):
        candidate = Path("/usr/bin") / name
        if not candidate.exists():
            candidate = Path("/bin") / name
        (mock / name).symlink_to(candidate)

    udev_driver = f'''#!{sys.executable}
import os, sys
from pathlib import Path
root = Path(os.environ["FIXTURE_ROOT"])
with (root / "calls").open("a") as log:
    log.write("udevadm " + " ".join(sys.argv[1:]) + "\\n")
sys.exit(int(os.environ.get("UDEV_EXIT", "0")))
'''
    udevadm = mock / "udevadm"
    udevadm.write_text(udev_driver)
    udevadm.chmod(0o755)

    rule = root / "etc/udev/rules.d/70-ams-access-camera.rules"
    expected = (
        "# AMS Access — grant session user access to webcam for proctoring camera check.\n"
        'SUBSYSTEM=="video4linux", TAG+="uaccess"\n'
    )

    def reset():
        if rule.exists():
            rule.unlink()
        (root / "calls").write_text("")

    def run(action, *, with_udev=True, udev_exit=0):
        path = str(mock)
        hidden = None
        if not with_udev:
            hidden = udevadm.with_name("udevadm.hidden")
            udevadm.rename(hidden)
        try:
            env = dict(
                os.environ,
                PATH=path,
                FIXTURE_ROOT=str(root),
                UDEV_EXIT=str(udev_exit),
            )
            return subprocess.run(
                ["/bin/sh", str(script), action],
                env=env,
                capture_output=True,
                text=True,
                timeout=5,
            )
        finally:
            if hidden is not None:
                hidden.rename(udevadm)

    # Debian configure and RPM install/upgrade numeric hooks share the install
    # behavior. A restrictive umask must not change the final public rule mode.
    for action in ("configure", "1", "2"):
        reset()
        old_umask = os.umask(0o077)
        try:
            result = run(action)
        finally:
            os.umask(old_umask)
        assert result.returncode == 0, (action, result.stdout, result.stderr)
        assert rule.read_text() == expected, action
        assert stat.S_IMODE(rule.stat().st_mode) == 0o644, action
        assert (root / "calls").read_text().splitlines() == [
            "udevadm control --reload-rules",
            "udevadm trigger --subsystem-match=video4linux",
        ], action

    # Minimal/container images without udev still configure successfully.
    reset()
    result = run("configure", with_udev=False)
    assert result.returncode == 0, result.stderr
    assert rule.read_text() == expected
    assert (root / "calls").read_text() == ""

    # A present but unusable udev daemon is best-effort; package configuration
    # succeeds and retains the correctly installed rule.
    reset()
    result = run("configure", udev_exit=1)
    assert result.returncode == 0, result.stderr
    assert rule.read_text() == expected
    assert len((root / "calls").read_text().splitlines()) == 2

    for action in ("abort-upgrade", "abort-remove", "abort-deconfigure"):
        reset()
        result = run(action)
        assert result.returncode == 0, (action, result.stderr)
        assert not rule.exists(), action
        assert (root / "calls").read_text() == "", action

    reset()
    result = run("unknown")
    assert result.returncode != 0
    assert "unknown argument" in result.stderr
    assert not rule.exists()
    assert (root / "calls").read_text() == ""

    print("postinst: 9 mocked scenarios passed; no host udev or filesystem paths used")
PY
