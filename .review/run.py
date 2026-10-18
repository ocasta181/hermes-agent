"""Run the same native packaged UI acceptance suite locally and in hosted VMs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--evidence', type=Path, required=True)
parser.add_argument('--inputs', type=Path, required=True)
parser.add_argument('--case', choices=['engine-pause-resume','engine-discard','model-resume'], required=True)
parser.add_argument('--prepared', action='store_true')
args = parser.parse_args()
here = Path(__file__).resolve().parent
args.evidence.mkdir(parents=True, exist_ok=True)
package = json.loads(subprocess.check_output(['node', str(here/'package.mjs'), str(args.source)], text=True))
if not args.prepared:
    subprocess.run([sys.executable, str(here/'prepare.py'), '--source', str(args.source),
        '--payload', package['payload'], '--inputs', str(args.inputs)], check=True)
env = dict(os.environ, RECOVERY_SOURCE_ROOT=str(args.source),
    RECOVERY_EVIDENCE_ROOT=str(args.evidence), RECOVERY_INPUTS_JSON=str(args.inputs/'inputs.json'))
env.setdefault('RECOVERY_SOURCE_COMMIT', subprocess.check_output(['git','rev-parse','HEAD'],cwd=args.source,text=True).strip())
command = ['node', str(args.source/'node_modules/@playwright/test/cli.js'),
    'test', '--config', str(here/'playwright.config.mjs'), '--grep', args.case + '$']
if sys.platform.startswith('linux'):
    command = ['xvfb-run','-a',*command]
sys.exit(subprocess.run(command, cwd=args.source, env=env, timeout=240).returncode)
