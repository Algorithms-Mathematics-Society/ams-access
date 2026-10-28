#!/usr/bin/env python3
"""Read-only macOS release gate. Never removes quarantine or changes trust settings."""
import argparse
import json
import plistlib
import subprocess
import sys
from pathlib import Path


def bundle_identity(app, expected_version):
    with (app / 'Contents/Info.plist').open('rb') as source:
        info = plistlib.load(source)
    if info.get('CFBundleIdentifier') != 'com.ams.access':
        raise ValueError('Unexpected bundle identifier')
    if info.get('CFBundleShortVersionString') != expected_version:
        raise ValueError('Bundle version does not match the release version')
    name = info.get('CFBundleExecutable')
    if not isinstance(name, str) or not name or Path(name).name != name or name in ('.', '..'):
        raise ValueError('Invalid executable name in Info.plist')
    executable = app / 'Contents/MacOS' / name
    if not executable.is_file() or not executable.resolve().is_relative_to(app.resolve()):
        raise ValueError('Bundle executable missing or points outside the app')
    return executable, info


def check(app, version, arch, team, run=subprocess.run):
    executable, info = bundle_identity(app, version)
    commands = [
        ['/usr/bin/lipo', '-verify_arch', arch, str(executable)],
        ['/usr/bin/codesign', '--verify', '--deep', '--strict', '--verbose=2', str(app)],
        ['/usr/bin/codesign', '--display', '--verbose=4', str(app)],
        ['/usr/sbin/spctl', '--assess', '--type', 'execute', '--verbose=4', str(app)],
    ]
    for command in commands:
        result = run(command, capture_output=True, text=True, timeout=60, check=False)
        if result.returncode:
            raise ValueError(f'{Path(command[0]).name} rejected the artifact: {result.stderr.strip()}')
        if '--display' in command:
            fields = result.stdout.splitlines() + result.stderr.splitlines()
            if f'TeamIdentifier={team}' not in fields:
                raise ValueError('Signing team does not match the release team')
            if 'Identifier=com.ams.access' not in fields:
                raise ValueError('Signing identifier does not match the application')
            if not any(line.startswith('Authority=Developer ID Application:') for line in fields):
                raise ValueError('Release must use Developer ID Application signing')
    return {'bundle_id': info['CFBundleIdentifier'], 'version': version, 'architecture': arch,
            'team': team, 'signature_and_gatekeeper': 'accepted',
            'native_launch_and_upgrade': 'requires manual GUI verification'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--version', required=True)
    parser.add_argument('--arch', required=True, choices=['arm64', 'x86_64'])
    parser.add_argument('--team', required=True)
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.exit(2, 'Artifact verification requires macOS; no checks were performed.\n')
    if not args.team.strip():
        parser.exit(2, 'Expected Apple signing team is required.\n')
    try:
        result = check(args.app.resolve(), args.version, args.arch, args.team)
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        parser.exit(1, f'Mac release verification failed: {error}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
