"""Stop only gateways and native binaries owned by this exact test sandbox."""
import json
import os
from pathlib import Path
import shlex

import psutil

from gateway.status import looks_like_gateway_command_line

home = Path(os.environ['HOME']).resolve()
hermes_home = Path(os.environ['HERMES_HOME']).resolve()
assert home.name.startswith('hermes-e2e-native-')
assert hermes_home == home / 'hermes-home'
owned = []
for process in psutil.process_iter():
    if process.pid == os.getpid():
        continue
    try:
        env = process.environ()
        if env.get('HERMES_HOME') != str(hermes_home):
            continue
        gateway = looks_like_gateway_command_line(shlex.join(process.cmdline()))
        native = Path(process.exe()).resolve().is_relative_to(home)
        if gateway or native:
            owned.append(process)
    except (psutil.NoSuchProcess, psutil.AccessDenied):
        continue
for process in owned:
    try:
        process.terminate()
    except psutil.NoSuchProcess:
        pass
gone, alive = psutil.wait_procs(owned, timeout=8)
for process in alive:
    process.kill()
_, alive = psutil.wait_procs(alive, timeout=3)
print(json.dumps({'sandbox': str(home), 'stopped': [p.pid for p in owned],
                  'remaining': [p.pid for p in alive]}))
assert not alive, 'Test processes did not stop'
