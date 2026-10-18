"""Controlled data for a real packaged-UI/native-engine recovery test."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

MODEL_REPO = 'ggml-org/SmolLM2-135M-GGUF'
MODEL_REV = '44686446221a479a9227d7a895cf92930f86de8a'
MODEL_FILE = 'SmolLM2-135M-Q4_K_M.gguf'
MODEL_SHA = 'e3131339bf4e8065265593d4fd8f7bb7ff2d3abff1edb5618aa1197b89cad9f5'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--payload', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.source))
    from pm.downloader import Download, Source
    from pm.artifact_mirror import mirror_url

    args.inputs.mkdir(parents=True, exist_ok=True)
    package = 'llamacpp-metal' if sys.platform == 'darwin' else 'llamacpp-cpu'
    facts = json.loads((args.payload/'tools/facts.json').read_text())
    fact = facts['packages'][package]
    lock_path = args.payload/'hermes-agent/pm/lock.json'
    lock = json.loads(lock_path.read_text())
    pin = lock['packages'][package]
    artifacts = pin['artifacts'].get(fact['target'], pin['artifacts'].get('any'))
    artifacts = artifacts if isinstance(artifacts, list) else [artifacts]
    archives = []
    for index, artifact in enumerate(artifacts):
        filename = artifact['url'].rsplit('/', 1)[-1]
        destination = args.inputs/f'{index}-{filename}'
        Download([Source(mirror_url(artifact['sha256']), destination, artifact['sha256'],
                         fallbacks=(artifact['url'],))], partials_dir=args.inputs/'partials').run()
        archives.append({'path':str(destination), 'name':filename, **artifact})
    model = args.inputs/MODEL_FILE
    Download([Source(f'https://huggingface.co/{MODEL_REPO}/resolve/{MODEL_REV}/{MODEL_FILE}',
                     model, MODEL_SHA)], partials_dir=args.inputs/'partials').run()
    assert hashlib.sha256(model.read_bytes()).hexdigest() == MODEL_SHA
    manifest = json.loads((args.payload/'manifest.json').read_text())
    result = {'package':package, 'backend':'metal' if sys.platform == 'darwin' else 'cpu',
              'entry':fact['entry'], 'target':fact['target'], 'artifacts':archives,
              'model':str(model), 'model_file':MODEL_FILE, 'model_sha256':MODEL_SHA,
              'model_repo':MODEL_REPO, 'model_revision':MODEL_REV,
              'manifest':manifest, 'original_lock':lock,
              'engine_entries':[p['entry'] for name,p in facts['packages'].items() if name.startswith('llamacpp-')]}
    (args.inputs/'inputs.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'target':fact['target'], 'archives':len(archives), 'model_bytes':model.stat().st_size}))


if __name__ == '__main__':
    main()
