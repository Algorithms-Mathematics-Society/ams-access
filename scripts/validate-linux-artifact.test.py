#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import unittest

MODULE_PATH = Path(__file__).with_name("validate-linux-artifact.py")
spec = importlib.util.spec_from_file_location("artifact_validator", MODULE_PATH)
validator = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(validator)

def write_elf(path: Path, machine: int = 62):
    data = bytearray(64)
    data[:6] = b"\x7fELF\x02\x01"
    data[18:20] = struct.pack("<H", machine)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(0o755)

def squashfs_superblock(bytes_used: int = 96) -> bytes:
    data = bytearray(96)
    data[:4] = b"hsqs"
    struct.pack_into("<I", data, 12, 131072)
    struct.pack_into("<H", data, 22, 17)
    struct.pack_into("<H", data, 28, 4)
    struct.pack_into("<Q", data, 40, bytes_used)
    return bytes(data)

class ArtifactValidatorTests(unittest.TestCase):
    def make_tree(self, base: Path):
        root, control, expected_root = base / "root", base / "control", base / "expected"
        root.mkdir(); control.mkdir(); expected_root.mkdir()
        expected = {}
        for name in validator.EXPECTED:
            source = expected_root / name
            if name == "ams-access-networkhelper":
                write_elf(source)
            else:
                source.write_bytes(("expected:" + name).encode())
            expected[name] = source
            folder = "helpers" if name in {
                "ams-access-networkhelper", "ams-proctor-helper.service",
                "com.ams.access.networkhelper.policy",
            } else "models/blazeface"
            target = root / "usr/lib/ams-access/resources" / folder / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        write_elf(root / "usr/bin/ams-access")
        for hook in ("postinst", "prerm"):
            shutil.copy2(validator.TAURI / "debian" / hook, control / hook)
        return root, control, expected

    def inspect(self, root, control, expected, kind="deb", metadata=None):
        if metadata is None and kind == "deb":
            metadata = {"dependencies": ", ".join(validator.REQUIRED_DEPENDENCIES["deb"])}
        return validator.inspect_tree(root, kind, metadata or {}, control, expected)

    def test_deb_tree_accepts_exact_resources_elf_hooks_and_dependencies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            result = self.inspect(root, control, expected)
            self.assertTrue(result["valid"], result)

    def test_missing_named_main_rejects_unrelated_x86_64_executable(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            (root / "usr/bin/ams-access").unlink()
            write_elf(root / "AppRun")
            result = self.inspect(root, control, expected)
            failed = {item["name"] for item in result["checks"] if not item["ok"]}
            self.assertIn("main:x86_64-executable", failed)

    def test_wrong_architecture_main_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            write_elf(root / "usr/bin/ams-access", machine=183)
            result = self.inspect(root, control, expected)
            failed = {item["name"] for item in result["checks"] if not item["ok"]}
            self.assertIn("main:x86_64-executable", failed)

    def test_changed_model_and_missing_media_plugin_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            next(root.rglob("model.json")).write_text("changed")
            result = self.inspect(root, control, expected, "appimage")
            failed = {item["name"] for item in result["checks"] if not item["ok"]}
            self.assertIn("resource:model.json", failed)
            self.assertIn("appimage:gstreamer-v4l2", failed)

    def make_rewriter(self, path: Path, suffix: bytes):
        path.write_text(
            f"#!{sys.executable}\n"
            "from pathlib import Path\n"
            "import sys\n"
            f"suffix = {suffix!r}\n"
            "assert sys.argv[1:3] == ['--set-rpath', '$ORIGIN']\n"
            "target = Path(sys.argv[3])\n"
            "target.write_bytes(target.read_bytes() + suffix)\n"
        )
        path.chmod(0o755)

    def test_appimage_accepts_only_exact_trusted_rewriter_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root, control, expected = self.make_tree(base)
            packaged_helper = next(root.rglob("ams-access-networkhelper"))
            packaged_helper.write_bytes(packaged_helper.read_bytes() + b"RUNPATH:$ORIGIN")
            plugin = root / "usr/lib/gstreamer-1.0/libgstvideo4linux2.so"
            plugin.parent.mkdir(parents=True)
            plugin.write_bytes(b"fixture")
            rewriter = base / "trusted-patchelf"
            self.make_rewriter(rewriter, b"RUNPATH:$ORIGIN")
            result = validator.inspect_tree(
                root, "appimage", {}, control, expected, appimage_patchelf=rewriter
            )
            self.assertTrue(result["valid"], result)
            helper_check = next(
                item for item in result["checks"]
                if item["name"] == "resource:ams-access-networkhelper"
            )
            self.assertEqual(
                validator.sha256(rewriter), helper_check["detail"]["rewriter_sha256"]
            )

    def test_appimage_rewriter_does_not_accept_other_binary_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root, control, expected = self.make_tree(base)
            packaged_helper = next(root.rglob("ams-access-networkhelper"))
            packaged_helper.write_bytes(packaged_helper.read_bytes() + b"RUNPATH:$ORIGIN-tampered")
            plugin = root / "usr/lib/gstreamer-1.0/libgstvideo4linux2.so"
            plugin.parent.mkdir(parents=True)
            plugin.write_bytes(b"fixture")
            rewriter = base / "trusted-patchelf"
            self.make_rewriter(rewriter, b"RUNPATH:$ORIGIN")
            result = validator.inspect_tree(
                root, "appimage", {}, control, expected, appimage_patchelf=rewriter
            )
            helper_check = next(
                item for item in result["checks"]
                if item["name"] == "resource:ams-access-networkhelper"
            )
            self.assertFalse(helper_check["ok"])

    def test_appimage_tree_accepts_v4l2_plugin(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            plugin = root / "usr/lib/gstreamer-1.0/libgstvideo4linux2.so"
            plugin.parent.mkdir(parents=True)
            plugin.write_bytes(b"fixture")
            result = self.inspect(root, control, expected, "appimage")
            self.assertTrue(result["valid"], result)

    def test_appimage_offset_skips_false_early_magic(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "candidate.AppImage"
            false_header = b"hsqs" + b"\0" * 92
            image.write_bytes(false_header + b"X" * 32 + squashfs_superblock())
            self.assertEqual(128, validator.appimage_offset(image))

    def test_invalid_squashfs_header_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "candidate.AppImage"
            image.write_bytes(b"ELF" + b"hsqs" + b"\0" * 100)
            with self.assertRaises(RuntimeError):
                validator.appimage_offset(image)

    def rpm_metadata(self, postinst=None, prerm=None):
        postinst = postinst or (validator.TAURI / "debian/postinst").read_text()
        prerm = prerm or (validator.TAURI / "debian/prerm").read_text()
        scripts = (
            "postinstall scriptlet (using /bin/sh):\n" + postinst
            + "\npreuninstall scriptlet (using /bin/sh):\n" + prerm
        )
        return {
            "dependencies": "\n".join(validator.REQUIRED_DEPENDENCIES["rpm"]),
            "scripts": scripts,
        }

    def test_rpm_requires_current_hooks_in_corresponding_scriptlets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            result = self.inspect(root, control, expected, "rpm", self.rpm_metadata())
            self.assertTrue(result["valid"], result)

    def test_deb_rejects_polkitd_without_pkexec_and_missing_glib_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            dependencies = [
                dep for dep in validator.REQUIRED_DEPENDENCIES["deb"]
                if dep not in {"pkexec", "libglib2.0-bin"}
            ]
            dependencies.append("polkitd")
            result = self.inspect(
                root, control, expected, "deb", {"dependencies": ", ".join(dependencies)}
            )
            dependency_check = next(
                item for item in result["checks"] if item["name"] == "dependencies:runtime"
            )
            self.assertFalse(dependency_check["ok"])
            self.assertEqual(
                {"pkexec", "libglib2.0-bin"}, set(dependency_check["detail"]["missing"])
            )

    def test_rpm_rejects_retired_xorg_server_utils_dependency(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            metadata = self.rpm_metadata()
            metadata["dependencies"] += "\nxorg-x11-server-utils\n"
            result = self.inspect(root, control, expected, "rpm", metadata)
            dependency_check = next(
                item for item in result["checks"] if item["name"] == "dependencies:runtime"
            )
            self.assertFalse(dependency_check["ok"])
            self.assertEqual(
                ["xorg-x11-server-utils"], dependency_check["detail"]["forbidden"]
            )

    def test_rpm_rejects_old_hooks_with_tokens_but_no_numeric_normalization(self):
        with tempfile.TemporaryDirectory() as tmp:
            root, control, expected = self.make_tree(Path(tmp))
            current_post = (validator.TAURI / "debian/postinst").read_text()
            current_pre = (validator.TAURI / "debian/prerm").read_text()
            old_post = "#!/bin/sh\nset -e\n\n" + current_post[current_post.index("# Grant the currently") :]
            old_pre = "#!/bin/sh\nset -e\n\n" + current_pre[current_pre.index("UDEV_RULE_PATH=") :]
            self.assertIn("70-ams-access-camera.rules", old_post)
            self.assertIn("AMS_PROCTOR", old_pre)
            self.assertNotIn("invalid RPM install count", old_post)
            result = self.inspect(
                root, control, expected, "rpm", self.rpm_metadata(old_post, old_pre)
            )
            failed = {item["name"] for item in result["checks"] if not item["ok"]}
            self.assertIn("hook:postinstall", failed)
            self.assertIn("hook:preremove", failed)

    def test_format_rejects_unrecognized_artifact(self):
        with self.assertRaises(ValueError):
            validator.kind_for(Path("candidate.tar.gz"))

if __name__ == "__main__":
    unittest.main()
