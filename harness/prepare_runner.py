"""Cache preparation, with no recovery scenario executed."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

source = Path.cwd()
here = Path(__file__).resolve().parent
package = json.loads(subprocess.check_output(['node', str(here/'package.mjs'), str(source)], text=True))
subprocess.run([sys.executable, str(here/'prepare.py'), '--source', str(source),
    '--payload', package['payload'], '--inputs', str(source/'.build/recovery-native-inputs')], check=True)
driver = source/'.build/recovery-driver'
driver.mkdir(parents=True, exist_ok=True)
shutil.copy2(shutil.which('node'), driver/('node.exe' if os.name=='nt' else 'node'))
(driver/'receipt.json').write_text(json.dumps({'source':os.environ['RECOVERY_SOURCE_COMMIT'],
    'build':os.environ['GITHUB_SHA'], 'node':subprocess.check_output(['node','--version'],text=True).strip()}))
