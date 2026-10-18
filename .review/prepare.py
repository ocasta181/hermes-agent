"""Controlled data for a real packaged-UI/native-engine recovery test."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys

MODEL_REV = 'b2bb62b5f3af7b55f8553ed037c8b7b691250b80'
MODEL_FILE = 'stories15M-q4_0.gguf'
MODEL_SHA = '6151b1929d7f5aa3385d9ddef3393e55587c0a55de661562322bc51dfda93a04'


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
    Download([Source(f'https://huggingface.co/ggml-org/tiny-llamas/resolve/{MODEL_REV}/{MODEL_FILE}',
                     model, MODEL_SHA)], partials_dir=args.inputs/'partials').run()
    assert hashlib.sha256(model.read_bytes()).hexdigest() == MODEL_SHA
    manifest = json.loads((args.payload/'manifest.json').read_text())
    result = {'package':package, 'backend':'metal' if sys.platform == 'darwin' else 'cpu',
              'entry':fact['entry'], 'target':fact['target'], 'artifacts':archives,
              'model':str(model), 'model_file':MODEL_FILE, 'model_sha256':MODEL_SHA,
              'manifest':manifest, 'original_lock':lock,
              'engine_entries':[p['entry'] for name,p in facts['packages'].items() if name.startswith('llamacpp-')]}
    (args.inputs/'inputs.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({'target':fact['target'], 'archives':len(archives), 'model_bytes':model.stat().st_size}))


if __name__ == '__main__':
    main()
