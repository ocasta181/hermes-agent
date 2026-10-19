import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [source, evidence] = process.argv.slice(2)
const require = createRequire(join(source, 'apps/desktop/package.json'))
const { build } = require('esbuild')
const electron = require('electron')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim()
await mkdir(evidence, { recursive: true })
const bundle = join(evidence, 'portal-fixture.cjs')
await build({
  entryPoints: [join(source, 'apps/desktop/electron/portal-session-live-fixture/main.ts')],
  outfile: bundle, bundle: true, platform: 'node', format: 'cjs', external: ['electron']
})
const results = []
for (const mode of ['original', 'private-home']) {
  const root = await mkdtemp(join(evidence, mode + '-'))
  const env = {}
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR']) {
    if (process.env[name]) env[name] = process.env[name]
  }
  env.HERMES_HOME = join(root, '.hermes')
  env.XDG_CONFIG_HOME = join(root, 'config')
  if (mode === 'private-home') env.HOME = root
  console.log('PORTAL_ENVIRONMENT_START', mode, revision)
  const child = spawn(electron, [bundle, root, '--no-sandbox', '--disable-gpu'], {
    cwd: join(source, 'apps/desktop'), env, stdio: 'inherit', detached: true
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    process.kill(-child.pid, 'SIGKILL')
  }, 40000)
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ mode, code, signal, timedOut, revision }))
  }).finally(() => clearTimeout(timer))
  results.push(result)
  console.log('PORTAL_ENVIRONMENT_RESULT', JSON.stringify(result))
}
await writeFile(join(evidence, 'comparison.json'), JSON.stringify(results, null, 2) + '\n')
if (results.find(row => row.mode === 'private-home').code !== 0) process.exitCode = 1

