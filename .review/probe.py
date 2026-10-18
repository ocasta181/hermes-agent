"""Read-only witnesses from the packaged Python runtime; no product patches."""
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

from hermes_cli.local_runtime import bootstrap, catalog
from pm.paths import partials_root


action = sys.argv[1]
entry = catalog.CATALOG[0]
variant = entry.variants[0]
model = bootstrap.models_dir() / variant.files[0].local_name
if action == 'paths':
    print(json.dumps({'model': str(model), 'partials': str(partials_root()),
                      'variant': variant.model_id, 'family': entry.id}))
elif action == 'complete':
    from hermes_cli.config import load_config
    from hermes_cli.local_runtime.endpoint import _state_endpoint

    config = load_config()
    endpoint = _state_endpoint()
    assert endpoint, 'No owned managed native server'
    assert config['model']['provider'] == 'llamacpp', config['model']['provider']
    assert config['model']['default'] == variant.model_id, config['model']['default']
    body = {'model': variant.model_id, 'prompt': 'Once upon a time there was a',
            'max_tokens': 8, 'temperature': 0}
    req = urllib.request.Request(endpoint['base_url'].rstrip('/') + '/completions',
        data=json.dumps(body).encode(), headers={'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + endpoint['api_key']})
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            result = json.loads(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode()) from error
    assert result['choices'][0]['text'].strip(), result
    assert result['usage']['completion_tokens'] > 0, result
    from hermes_cli.local_runtime import binaries
    engine = binaries.installed_engine(sys.argv[2])
    print(json.dumps({'variant': variant.model_id, 'provider': config['model']['provider'],
        'model_sha256': hashlib.sha256(model.read_bytes()).hexdigest(),
        'engine': str(engine.binary), 'tag': engine.tag,
        'response': result['choices'][0]['text'], 'usage': result['usage']}))
else:
    raise ValueError(action)
