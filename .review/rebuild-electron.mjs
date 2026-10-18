// Incremental source build: keep the previously built, unchanged native payload.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { packagePaths } from './package.mjs'

const root = path.resolve(process.env.RECOVERY_SOURCE_ROOT)
const packaged = packagePaths(root)
const resources = path.dirname(packaged.payload)
const stamp = path.join(resources, 'install-stamp.json')
const metadata = JSON.parse(fs.readFileSync(stamp, 'utf8'))
const base = 'ae113298c1d300d409ce4bfac8b72cb9f43542e4'
const source = process.env.RECOVERY_SOURCE_COMMIT
const changed = execFileSync('git', ['diff', '--name-only', base, source], {cwd:root,encoding:'utf8'}).trim().split('\n')
assert.deepEqual(changed.sort(), ['apps/desktop/electron/main.ts',
  'apps/desktop/electron/payload-backend.test.ts','apps/desktop/electron/payload-backend.ts'].sort())
const { bundleElectronMain, electronOutputs } = await import(pathToFileURL(path.join(root,
  'apps/desktop/scripts/bundle-electron-main.mjs')).href)
const out = path.join(root, '.build/recovery-electron-source')
await bundleElectronMain({source:root,out,stamp})
const files = []
for (const name of Object.values(electronOutputs)) {
  const output = path.join(out,name)
  const destination = path.join(resources,'app.asar.unpacked/dist',name)
  assert(fs.existsSync(destination))
  fs.copyFileSync(output,destination)
  files.push({file:name,sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')})
}
const runtime = metadata.runtime
const python = path.join(packaged.payload,runtime.storePython)
const home = fs.mkdtempSync(path.join(os.tmpdir(),'hermes-ticket-preflight-'))
try {
  const env = {...process.env,HOME:home,USERPROFILE:home,HERMES_HOME:path.join(home,'hermes-home'),
    PYTHONHOME:'',PYTHONPATH:[path.join(packaged.payload,runtime.repoDir),
      path.join(packaged.payload,runtime.sitePackages)].join(path.delimiter),
    PYTHONPYCACHEPREFIX:path.join(home,'pycache')}
  const imported = spawnSync(python,['-P','-c',
    'from hermes_cli.gateway_client import _session_ticket; print("ticket imports ready")'],
    {env,encoding:'utf8',timeout:20000})
  assert.equal(imported.status,0,imported.stderr)
  let rejectedLauncher
  if (process.env.RECOVERY_CASE === 'engine-pause-resume') {
    const wrong = spawnSync(path.join(packaged.payload,runtime.commands.hermes),
      ['-P','-u','-c','print("bare interpreter")'],{env,encoding:'utf8',timeout:20000})
    assert.notEqual(wrong.status,0,'The CLI unexpectedly accepted interpreter arguments')
    rejectedLauncher={status:wrong.status,stderr:wrong.stderr.slice(-1500)}
  }
  const evidence = process.env.RECOVERY_EVIDENCE_ROOT
  fs.mkdirSync(evidence,{recursive:true})
  fs.writeFileSync(path.join(evidence,'incremental-build.json'),JSON.stringify({
    electron_source:source,unchanged_runtime_source:base,original_build:metadata.commit,
    scope:changed,files,ticket_imports:imported.stdout.trim(),rejectedLauncher
  },null,2))
  if (process.env.RECOVERY_CASE === 'engine-pause-resume') {
    execFileSync(process.execPath,[path.join(root,'node_modules/vitest/vitest.mjs'),'run',
      '--project','electron','--maxWorkers','1','electron/payload-backend.test.ts',
      'electron/local-gateway-python-runtime.test.ts'],{cwd:path.join(root,'apps/desktop'),
      env:{...process.env,HERMES_PYTHON:python},stdio:'inherit',timeout:60000})
  }
} finally {
  fs.rmSync(home,{recursive:true,force:true})
}
