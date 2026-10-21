#!/usr/bin/env python3
"""Read-only validation for AMS Access Linux packages.

Archives are extracted into a temporary directory. The validator never installs
or launches the package, its application, or its maintainer scripts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
from typing import Any

REPO = Path(__file__).resolve().parents[1]
TAURI = REPO / "apps/desktop/src-tauri"
EXPECTED = {
    "ams-access-networkhelper": TAURI / "helpers/ams-access-networkhelper",
    "ams-proctor-helper.service": TAURI / "helpers/ams-proctor-helper.service",
    "com.ams.access.networkhelper.policy": TAURI / "helpers/com.ams.access.networkhelper.policy",
    "group1-shard1of1.bin": REPO / "apps/web/public/models/blazeface/group1-shard1of1.bin",
    "manifest.json": REPO / "apps/web/public/models/blazeface/manifest.json",
    "model.json": REPO / "apps/web/public/models/blazeface/model.json",
}
REQUIRED_DEPENDENCIES = {
    "deb": (
        "libwebkit2gtk-4.1-0", "libgtk-3-0", "libglib2.0-bin", "pkexec",
        "gstreamer1.0-plugins-base", "gstreamer1.0-plugins-good",
    ),
    "rpm": ("webkit2gtk4.1", "gtk3", "gstreamer1-plugins-base", "gstreamer1-plugins-good"),
}
FORBIDDEN_DEPENDENCIES = {
    "rpm": ("xorg-x11-server-utils",),
}
MAX_RPM_PAYLOAD_BYTES = 512 * 1024 * 1024

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def run(args: list[str], **kwargs: Any) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, check=True, capture_output=True, text=False, **kwargs)
    except FileNotFoundError as exc:
        raise RuntimeError(f"required extraction tool is unavailable: {args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode(errors="replace").strip()
        raise RuntimeError(f"command failed ({args[0]}): {detail}") from exc

def kind_for(path: Path) -> str:
    lower = path.name.lower()
    if lower.endswith(".deb"): return "deb"
    if lower.endswith(".rpm"): return "rpm"
    if lower.endswith(".appimage"): return "appimage"
    raise ValueError("artifact must end in .deb, .rpm, or .AppImage")

def stage_rpm_payload(artifact: Path, payload: Any) -> None:
    with tempfile.TemporaryFile() as rpm_stderr:
        try:
            rpm2cpio = subprocess.Popen(
                ["rpm2cpio", str(artifact)], stdout=subprocess.PIPE, stderr=rpm_stderr
            )
        except FileNotFoundError as exc:
            raise RuntimeError("required extraction tool is unavailable: rpm2cpio") from exc
        total = 0
        overflow = False
        try:
            assert rpm2cpio.stdout is not None
            while chunk := rpm2cpio.stdout.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_RPM_PAYLOAD_BYTES:
                    overflow = True
                    rpm2cpio.kill()
                    break
                payload.write(chunk)
        except BaseException:
            if rpm2cpio.poll() is None:
                rpm2cpio.kill()
            rpm2cpio.wait()
            raise
        finally:
            if rpm2cpio.stdout is not None:
                rpm2cpio.stdout.close()
        rpm_status = rpm2cpio.wait()
        rpm_stderr.seek(0)
        stderr = rpm_stderr.read().decode(errors="replace").strip()
    if overflow:
        raise RuntimeError(f"RPM payload exceeds {MAX_RPM_PAYLOAD_BYTES} byte validation limit")
    if rpm_status:
        detail = f": {stderr}" if stderr else ""
        raise RuntimeError(f"rpm2cpio failed with status {rpm_status}{detail}")
    payload.seek(0)

def appimage_offset(path: Path) -> int:
    # SquashFS magic can occur in the ELF stub by coincidence. Accept only a
    # complete, internally consistent v4 superblock whose filesystem fits in
    # the artifact, then continue searching after false matches.
    marker = b"hsqs"
    size = path.stat().st_size
    with path.open("rb") as stream:
        offset = 0
        overlap = b""
        while chunk := stream.read(1024 * 1024):
            block = overlap + chunk
            start = 0
            while (found := block.find(marker, start)) >= 0:
                candidate = offset - len(overlap) + found
                current = stream.tell()
                stream.seek(candidate)
                superblock = stream.read(96)
                stream.seek(current)
                if len(superblock) == 96:
                    block_size = struct.unpack_from("<I", superblock, 12)[0]
                    block_log = struct.unpack_from("<H", superblock, 22)[0]
                    major = struct.unpack_from("<H", superblock, 28)[0]
                    bytes_used = struct.unpack_from("<Q", superblock, 40)[0]
                    valid_block = (
                        4096 <= block_size <= 1024 * 1024
                        and block_size & (block_size - 1) == 0
                        and block_log == block_size.bit_length() - 1
                    )
                    if major == 4 and valid_block and bytes_used >= 96 and candidate + bytes_used <= size:
                        return candidate
                start = found + 1
            overlap = block[-95:]
            offset += len(chunk)
    raise RuntimeError("valid AppImage SquashFS v4 superblock not found")

def extract(artifact: Path, kind: str, root: Path, control: Path) -> dict[str, str]:
    metadata: dict[str, str] = {}
    if kind == "deb":
        run(["dpkg-deb", "-x", str(artifact), str(root)])
        run(["dpkg-deb", "-e", str(artifact), str(control)])
        metadata["dependencies"] = run(["dpkg-deb", "-f", str(artifact), "Depends"]).stdout.decode(errors="replace").strip()
    elif kind == "rpm":
        with tempfile.TemporaryFile() as rpm_payload:
            stage_rpm_payload(artifact, rpm_payload)
            try:
                unpack = subprocess.run(
                    ["cpio", "-idm", "--quiet", "--no-absolute-filenames"],
                    cwd=root, stdin=rpm_payload, capture_output=True,
                )
            except FileNotFoundError as exc:
                raise RuntimeError("required extraction tool is unavailable: cpio") from exc
        if unpack.returncode:
            detail = unpack.stderr.decode(errors="replace").strip()
            suffix = f": {detail}" if detail else ""
            raise RuntimeError(f"cpio failed with status {unpack.returncode}{suffix}")
        metadata["dependencies"] = run(["rpm", "-qp", "--requires", str(artifact)]).stdout.decode(errors="replace")
        metadata["scripts"] = run(["rpm", "-qp", "--scripts", str(artifact)]).stdout.decode(errors="replace")
    else:
        offset = appimage_offset(artifact)
        run(["unsquashfs", "-no-progress", "-o", str(offset), "-d", str(root), str(artifact)])
        metadata["squashfs_offset"] = str(offset)
    return metadata

def elf_x86_64(path: Path) -> bool:
    try:
        with path.open("rb") as stream:
            head = stream.read(20)
    except OSError:
        return False
    if len(head) < 20 or head[:5] != b"\x7fELF\x02": return False
    endian = "<" if head[5] == 1 else ">" if head[5] == 2 else ""
    return bool(endian) and struct.unpack(endian + "H", head[18:20])[0] == 62

def matches(root: Path, name: str) -> list[Path]:
    return sorted((p for p in root.rglob(name) if p.is_file()), key=lambda p: str(p))

def rewritten_helper_hash(source: Path, rewriter: Path) -> str:
    rewriter = rewriter.resolve(strict=True)
    if not rewriter.is_file() or not os.access(rewriter, os.X_OK):
        raise RuntimeError(f"AppImage patchelf is not executable: {rewriter}")
    with tempfile.TemporaryDirectory(prefix="ams-helper-identity-") as tmp:
        candidate = Path(tmp) / source.name
        shutil.copy2(source, candidate)
        run([str(rewriter), "--set-rpath", "$ORIGIN", str(candidate)])
        return sha256(candidate)

def normalize_script_body(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    if lines and lines[0].startswith("#!"):
        lines.pop(0)
        while lines and not lines[0]:
            lines.pop(0)
    return "\n".join(lines)

def rpm_scriptlets(output: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    header = re.compile(r"^([a-z]+) scriptlet(?: \(using [^)]+\))?:\s*$", re.IGNORECASE)
    for line in output.replace("\r\n", "\n").split("\n"):
        match = header.match(line)
        if match:
            current = match.group(1).lower()
            sections.setdefault(current, [])
        elif current is not None:
            sections[current].append(line)
    return {name: normalize_script_body("\n".join(lines)) for name, lines in sections.items()}

def dependency_present(metadata: str, name: str) -> bool:
    package_char = r"A-Za-z0-9_.+-"
    return re.search(
        rf"(?<![{package_char}]){re.escape(name)}(?![{package_char}])", metadata
    ) is not None

def inspect_tree(
    root: Path,
    kind: str,
    metadata: dict[str, str],
    control: Path,
    expected: dict[str, Path] | None = None,
    appimage_patchelf: Path | None = None,
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    def check(name: str, ok: bool, detail: Any) -> None:
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    expected = EXPECTED if expected is None else expected
    for name, source in expected.items():
        found = matches(root, name)
        expected_hashes = {sha256(source)} if source.exists() else set()
        identity_mode = "exact-source"
        rewriter_hash = None
        if kind == "appimage" and name == "ams-access-networkhelper" and appimage_patchelf is not None:
            expected_hashes = {rewritten_helper_hash(source, appimage_patchelf)}
            identity_mode = "exact-linuxdeploy-patchelf-output"
            rewriter_hash = sha256(appimage_patchelf)
        exact = [item for item in found if sha256(item) in expected_hashes]
        check(
            "resource:" + name,
            len(exact) == 1,
            {
                "paths": [str(item.relative_to(root)) for item in found],
                "identity": identity_mode,
                "rewriter_sha256": rewriter_hash,
            },
        )

    helper = matches(root, "ams-access-networkhelper")
    helper = [p for p in helper if "helpers" in p.parts]
    check("helper:x86_64-executable", len(helper) == 1 and elf_x86_64(helper[0]) and os.access(helper[0], os.X_OK), [str(p.relative_to(root)) for p in helper])

    # Do not let AppRun, a library, or another bundled executable stand in for
    # the product binary. Tauri places it at this path in all three formats.
    main_path = root / "usr/bin/ams-access"
    main_ok = main_path.is_file() and os.access(main_path, os.X_OK) and elf_x86_64(main_path)
    check("main:x86_64-executable", main_ok, str(main_path.relative_to(root)))

    if kind == "deb":
        for hook in ("postinst", "prerm"):
            path = control / hook
            expected_hook = TAURI / "debian" / hook
            check("hook:" + hook, path.is_file() and sha256(path) == sha256(expected_hook), str(path) if path.exists() else None)
    elif kind == "rpm":
        scriptlets = rpm_scriptlets(metadata.get("scripts", ""))
        for check_name, section_name, source_name in (
            ("hook:postinstall", "postinstall", "postinst"),
            ("hook:preremove", "preuninstall", "prerm"),
        ):
            expected_body = normalize_script_body((TAURI / "debian" / source_name).read_text())
            actual_body = scriptlets.get(section_name, "")
            check(
                check_name,
                bool(expected_body) and expected_body in actual_body,
                {"source": source_name, "scriptlet": section_name, "present": bool(actual_body)},
            )

    if kind in REQUIRED_DEPENDENCIES:
        deps = metadata.get("dependencies", "")
        missing = [dep for dep in REQUIRED_DEPENDENCIES[kind] if not dependency_present(deps, dep)]
        forbidden = [dep for dep in FORBIDDEN_DEPENDENCIES.get(kind, ()) if dependency_present(deps, dep)]
        check(
            "dependencies:runtime",
            not missing and not forbidden,
            {
                "required": list(REQUIRED_DEPENDENCIES[kind]),
                "missing": missing,
                "forbidden": forbidden,
            },
        )
    else:
        plugins = [p for p in root.rglob("libgstvideo4linux2.so") if p.is_file()]
        check("appimage:gstreamer-v4l2", bool(plugins), [str(p.relative_to(root)) for p in plugins])

    return {"checks": checks, "valid": all(item["ok"] for item in checks)}

def validate(artifact: Path, appimage_patchelf: Path | None = None) -> dict[str, Any]:
    artifact = artifact.resolve(strict=True)
    kind = kind_for(artifact)
    result: dict[str, Any] = {"artifact": str(artifact), "format": kind, "sha256": sha256(artifact), "size": artifact.stat().st_size}
    with tempfile.TemporaryDirectory(prefix="ams-linux-artifact-") as tmp:
        base = Path(tmp)
        root, control = base / "root", base / "control"
        root.mkdir(); control.mkdir()
        metadata = extract(artifact, kind, root, control)
        result.update(inspect_tree(root, kind, metadata, control, appimage_patchelf=appimage_patchelf))
        result["metadata"] = metadata
    return result

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument(
        "--appimage-patchelf",
        type=Path,
        help="linuxdeploy patchelf used by the build; runs only on a temporary source-helper copy",
    )
    args = parser.parse_args()
    try:
        result = validate(args.artifact, args.appimage_patchelf)
    except (OSError, RuntimeError, ValueError) as exc:
        result = {"artifact": str(args.artifact), "valid": False, "error": str(exc)}
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result.get("valid") else 1

if __name__ == "__main__":
    raise SystemExit(main())
