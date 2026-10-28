"""Exercise release rejection paths without a Mac or weakening host security."""
import importlib.util
import plistlib
import platform
import subprocess
import sys
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('verify_macos_release', Path(__file__).with_name('verify-macos-release.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class ArtifactGate(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Path(self.temp.name) / 'AMS Access.app'
        (self.app/'Contents/MacOS').mkdir(parents=True)
        (self.app/'Contents/MacOS/access').write_bytes(b'fixture')
        self.identity = dict(CFBundleIdentifier='com.ams.access', CFBundleShortVersionString='4.7.0', CFBundleExecutable='access')
        self.save()

    def save(self):
        (self.app/'Contents/Info.plist').write_bytes(plistlib.dumps(self.identity))

    def native(self, command, **kwargs):
        text = 'Identifier=com.ams.access\nTeamIdentifier=EXPECTED\nAuthority=Developer ID Application: AMS\n'
        return SimpleNamespace(returncode=0, stdout='', stderr=text)

    def test_accepts_only_expected_identity_version_and_team(self):
        result = verify.check(self.app, '4.7.0', 'arm64', 'EXPECTED', self.native)
        self.assertEqual(result['signature_and_gatekeeper'], 'accepted')
        with self.assertRaisesRegex(ValueError, 'team'):
            verify.check(self.app, '4.7.0', 'arm64', 'OTHER', self.native)
        with self.assertRaisesRegex(ValueError, 'version'):
            verify.check(self.app, '4.8.0', 'arm64', 'EXPECTED', self.native)
        self.identity['CFBundleIdentifier'] = 'com.example.other'
        self.save()
        with self.assertRaisesRegex(ValueError, 'identifier'):
            verify.check(self.app, '4.7.0', 'arm64', 'EXPECTED', self.native)

    def test_lipo_input_precedes_variadic_architecture_arguments(self):
        for arch in ('arm64', 'x86_64'):
            calls = []
            def native(command, **kwargs):
                calls.append(command)
                return self.native(command, **kwargs)
            verify.check(self.app, '4.7.0', arch, 'EXPECTED', native)
            self.assertEqual(calls[0], ['/usr/bin/lipo',
                str(self.app / 'Contents/MacOS/access'), '-verify_arch', arch])

    @unittest.skipUnless(sys.platform == 'darwin', 'requires actual Apple lipo')
    def test_real_lipo_accepts_the_generated_command_with_a_spaced_bundle_path(self):
        executable = self.app / 'Contents/MacOS/access'
        subprocess.run(['/usr/bin/clang', '-x', 'c', '-', '-o', str(executable)],
                       input='int main(void) { return 0; }', text=True, check=True,
                       capture_output=True)
        def native(command, **kwargs):
            if command[0] == '/usr/bin/lipo':
                return subprocess.run(command, **kwargs)
            return self.native(command, **kwargs)
        arch = platform.machine()
        verify.check(self.app, '4.7.0', arch, 'EXPECTED', native)
        wrong = 'x86_64' if arch == 'arm64' else 'arm64'
        with self.assertRaisesRegex(ValueError, 'lipo'):
            verify.check(self.app, '4.7.0', wrong, 'EXPECTED', native)

    def test_every_native_failure_stops_release(self):
        for tool, flag in [('lipo','-verify_arch'), ('codesign','--verify'), ('codesign','--display'), ('spctl','--assess')]:
            with self.subTest(tool=tool, flag=flag):
                def fail(command, **kwargs):
                    if flag in command:
                        return SimpleNamespace(returncode=1, stderr='fixture failure', stdout='')
                    return self.native(command, **kwargs)
                with self.assertRaisesRegex(ValueError, tool):
                    verify.check(self.app, '4.7.0', 'arm64', 'EXPECTED', fail)

    def test_refuses_executable_path_traversal(self):
        self.identity['CFBundleExecutable'] = '../../../other'
        self.save()
        with self.assertRaisesRegex(ValueError, 'executable'):
            verify.bundle_identity(self.app, '4.7.0')

    def test_ad_hoc_signature_cannot_pass_as_release(self):
        def adhoc(command, **kwargs):
            return SimpleNamespace(returncode=0, stdout='', stderr='Identifier=com.ams.access\nTeamIdentifier=EXPECTED\nSignature=adhoc')
        with self.assertRaisesRegex(ValueError, 'Developer ID'):
            verify.check(self.app, '4.7.0', 'arm64', 'EXPECTED', adhoc)

    def dmg_runner(self, *, apps=1, reject_gate=False, reject_mount=False, reject_detach=False):
        calls = []
        def native(command, **kwargs):
            calls.append(command)
            if command[0].endswith('hdiutil'):
                if command[1] == 'attach':
                    self.assertIn('-readonly', command)
                    self.assertIn('-nobrowse', command)
                    if reject_mount:
                        return SimpleNamespace(returncode=1, stdout='', stderr='bad image')
                    mount = Path(command[command.index('-mountpoint') + 1])
                    for index in range(apps):
                        shutil.copytree(self.app, mount / f'AMS {index}.app')
                elif reject_detach:
                    return SimpleNamespace(returncode=1, stdout='', stderr='busy')
                return SimpleNamespace(returncode=0, stdout='', stderr='')
            if reject_gate and '--assess' in command:
                return SimpleNamespace(returncode=1, stdout='', stderr='untrusted')
            return self.native(command, **kwargs)
        return native, calls

    def test_dmg_only_release_checks_the_mounted_payload_and_detaches(self):
        native, calls = self.dmg_runner()
        result = verify.check_dmg(Path('AMS Access.dmg'), '4.7.0', 'arm64', 'EXPECTED', native)
        self.assertEqual(result['signature_and_gatekeeper'], 'accepted')
        self.assertEqual(calls[-1][1], 'detach')
        self.assertTrue(any('--assess' in command for command in calls))
        self.assertFalse(Path(calls[-1][-1]).exists())

    def test_dmg_rejection_still_detaches(self):
        native, calls = self.dmg_runner(reject_gate=True)
        with self.assertRaisesRegex(ValueError, 'spctl'):
            verify.check_dmg(Path('app.dmg'), '4.7.0', 'arm64', 'EXPECTED', native)
        self.assertEqual(calls[-1][1], 'detach')

    def test_missing_or_ambiguous_dmg_payload_is_rejected(self):
        for count in (0, 2):
            native, calls = self.dmg_runner(apps=count)
            with self.assertRaisesRegex(ValueError, 'exactly one'):
                verify.check_dmg(Path('app.dmg'), '4.7.0', 'arm64', 'EXPECTED', native)
            self.assertEqual(calls[-1][1], 'detach')

    def test_mount_failure_does_not_check_an_unmounted_directory(self):
        native, calls = self.dmg_runner(reject_mount=True)
        with self.assertRaisesRegex(ValueError, 'mount failed'):
            verify.check_dmg(Path('app.dmg'), '4.7.0', 'arm64', 'EXPECTED', native)
        self.assertEqual(len(calls), 1)

    def test_detach_failure_is_not_reported_as_a_success(self):
        native, _ = self.dmg_runner(reject_detach=True)
        with self.assertRaisesRegex(ValueError, 'detach failed'):
            verify.check_dmg(Path('app.dmg'), '4.7.0', 'arm64', 'EXPECTED', native)


if __name__ == '__main__':
    unittest.main()
