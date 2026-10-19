"""Use the full source bundle builder and select unpacked native app output."""
import argparse
import os
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.source))
from scripts.bundles import desktop

run = desktop.run


def directory_run(argv, **kwargs):
    # The controller supplies installer formats even when --dir was requested.
    # UI acceptance needs the packaged executable, without installer archives.
    if len(argv) > 1 and Path(argv[1]).name == 'run-electron-builder.mjs':
        argv = [part for part in argv if part not in {'AppImage', 'msix', 'dmg', 'zip'}]
    return run(argv, **kwargs)


desktop.run = directory_run
desktop.build(args.source, None, 'bundled', ['--dir', '--publish', 'never'],
              commit_build=os.environ['RECOVERY_SOURCE_COMMIT'])
