"""Exercise release rejection paths without a Mac or weakening host security."""
import importlib.util
import plistlib
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


if __name__ == '__main__':
    unittest.main()
