#!/bin/sh
# Safe packaging regression checks: generated copy uses only a temporary root,
# mock systemctl/firewall commands, and an isolated PATH. Never run real prerm.
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
python3 - "$SCRIPT_DIR/prerm" <<'PY'
from pathlib import Path
import os, socket, subprocess, sys, tempfile

source = Path(sys.argv[1]).read_text()
with tempfile.TemporaryDirectory(prefix="ams-prerm-review-") as work:
    root = Path(work)
    mock = root / "bin"
    mock.mkdir()
    # Shell text tools are harmless. No real firewall or service binary is put
    # into PATH; the command implementations below operate only on temp files.
    for name in ("grep", "rm", "rmdir", "timeout"):
        (mock / name).symlink_to(Path("/usr/bin") / name)
    fixture = source.replace("--kill-after=1s 8s", "--kill-after=0.1s 0.2s")
    for old, new in [("/etc/", str(root / "etc") + "/"), ("/usr/local/", str(root / "usr/local") + "/"),
                     ("/run/", str(root / "run") + "/"), ("/proc/sys/net/ipv6", str(root / "ipv6"))]:
        fixture = fixture.replace(old, new)
    script = root / "prerm"
    script.write_text(fixture)
    helper = root / "usr/local/lib/ams-access/ams-access-networkhelper"
    config = root / "etc/ams-access/network-helper-client.conf"
    unit = root / "etc/systemd/system/ams-proctor-helper.service"
    marker = root / "run/ams-proctor.lock"
    unrelated = root / "etc/ams-access/unrelated.conf"
    (root / "ipv6").mkdir()
    driver = f'''#!{sys.executable}
import os, sys, time
from pathlib import Path
root = Path(os.environ["FIXTURE_ROOT"])
name = Path(sys.argv[0]).name
args = sys.argv[1:]
with (root / "calls").open("a") as log: log.write(name + " " + " ".join(args) + "\\n")
mode = os.environ.get("FAIL_MODE", "")
if name == "systemctl":
    if mode == "hang-stop" and args[0] == "stop": time.sleep(60)
    if args[0] == "show":
        if mode == "hang-show": time.sleep(60)
        if mode == "show-error": sys.exit(1)
        print("loaded" if (root / "etc/systemd/system/ams-proctor-helper.service").exists() else "not-found")
        sys.exit(0)
    if args[0] in ("cat", "stop", "disable") and not (root / "etc/systemd/system/ams-proctor-helper.service").exists():
        sys.exit(5 if args[0] == "stop" else 1)
    sys.exit(1 if mode == "stop" and args[0] == "stop" else 0)
if name == "udevadm": sys.exit(0)
state = root / (name + ".state")
values = state.read_text().split() if state.exists() else []
operation = args[2]
if mode == "hang-inspect" and operation == "-S": time.sleep(60)
if mode == "inspect" and operation == "-S": sys.exit(2)
if mode == "ipv6" and name == "ip6tables": sys.exit(2)
if operation == "-S":
    print("-P OUTPUT ACCEPT")
    if "chain" in values: print("-N AMS_PROCTOR")
    if "jump" in values: print("-A OUTPUT -j AMS_PROCTOR")
elif operation == "-C": sys.exit(0 if "jump" in values else 1)
elif operation == "-D":
    if mode == "detach": sys.exit(2)
    if mode != "stuck-jump": values.remove("jump")
elif operation == "-F": pass
elif operation == "-X":
    if mode == "delete": sys.exit(2)
    values.remove("chain")
else: raise AssertionError(args)
state.write_text(" ".join(values))
'''
    for name in ("systemctl", "iptables", "ip6tables", "udevadm"):
        path = mock / name
        path.write_text(driver)
        path.chmod(0o755)
    def prepare():
        for file in (helper, config, unit, marker, unrelated):
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("fixture")
        for tool in ("iptables", "ip6tables"):
            (root / (tool + ".state")).write_text("chain jump")
        (root / "calls").write_text("")
    def run(action, mode=""):
        env = dict(os.environ, PATH=str(mock), FIXTURE_ROOT=str(root), FAIL_MODE=mode)
        return subprocess.run(["/bin/sh", str(script), action], env=env, capture_output=True, text=True, timeout=15)
    prepare()
    assert run("remove").returncode == 0
    assert all(not p.exists() for p in (helper, config, unit, marker))
    assert unrelated.read_text() == "fixture"
    calls = (root / "calls").read_text()
    assert calls.index("systemctl stop") < calls.index("iptables -w 5 -S") < calls.index("systemctl disable")
    assert (root / "iptables.state").read_text() == ""
    assert (root / "ip6tables.state").read_text() == ""
    for mode in ("stop", "inspect", "detach", "delete", "ipv6", "hang-stop", "hang-inspect", "stuck-jump"):
        prepare()
        result = run("remove", mode)
        assert result.returncode != 0, (mode, result.stdout, result.stderr)
        assert all(p.exists() for p in (helper, config, unit, marker)), mode
    for action in ("upgrade", "failed-upgrade", "deconfigure"):
        prepare()
        assert run(action).returncode == 0
        assert all(p.exists() for p in (helper, config, unit, marker))
        assert "systemctl" not in (root / "calls").read_text()
    prepare()
    for p in (helper, config, unit, marker): p.unlink()
    assert run("remove").returncode == 0
    assert "iptables" not in (root / "calls").read_text()
    assert run("unknown").returncode != 0
    for orphan in ("marker", "socket"):
        prepare()
        for p in (helper, config, unit, marker): p.unlink()
        if orphan == "marker": marker.write_text("fixture")
        else:
            sock = socket.socket(socket.AF_UNIX)
            sock.bind(str(root / "run/ams-proctor.sock"))
            sock.close()
        result = run("remove")
        assert result.returncode == 0, (orphan,result.stderr)
        calls = (root / "calls").read_text()
        assert "systemctl stop" not in calls and "systemctl disable" not in calls
        assert not marker.exists() and not (root / "run/ams-proctor.sock").exists()
        assert (root / "iptables.state").read_text() == ""
        assert (root / "ip6tables.state").read_text() == ""
    for mode in ("hang-show", "show-error"):
        prepare()
        unit.unlink()
        result = run("remove", mode)
        assert result.returncode != 0, (mode, result.stderr)
        assert all(p.exists() for p in (helper, config, marker))
        assert "iptables" not in (root / "calls").read_text()
    print("prerm: 18 mocked scenarios passed; no host service/firewall commands executed")
PY
