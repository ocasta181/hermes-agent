// Run the packaged app, packaged backend/PM, and actual host-native engine.
// Only artifact URLs/catalog data and network availability are controlled.
import { _electron, expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { transport } from './network.mjs'
import { packagePaths } from './package.mjs'

const root = path.resolve(process.env.RECOVERY_SOURCE_ROOT)
const here = import.meta.dirname
const { createSandbox, buildAppEnv } = await import(pathToFileURL(path.join(root, 'apps/desktop/e2e/fixtures.ts')).href)
const { writeMockProviderConfig, writeEnvFile } = await import(pathToFileURL(path.join(root, 'tests-js/scripts/mock-provider-config.ts')).href)
const packaged = packagePaths(root)
const inputs = JSON.parse(fs.readFileSync(process.env.RECOVERY_INPUTS_JSON, 'utf8'))
const runtime = inputs.manifest.runtime
const catalogPath = path.join(packaged.payload, 'hermes-agent/hermes_cli/local_runtime/catalog.json')
const lockPath = path.join(packaged.payload, 'hermes-agent/pm/lock.json')
const enginePaths = inputs.engine_entries.map(entry=>path.join(packaged.payload,'tools',entry))
const originalCatalog = fs.readFileSync(catalogPath)
const originalLock = fs.readFileSync(lockPath)
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function jobs(page) {
  return page.evaluate(async () => (await window.hermesDesktop.api({ path: '/api/local-models/jobs' })).jobs)
}

async function openSettings(page) {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click({ timeout: 90000 })
  await page.getByRole('button', { name: 'Providers', exact: true }).click()
  await page.getByRole('button', { name: 'Local Models', exact: true }).click()
}

function python(env, program, args = []) {
  const prelude = `import sys,site;sys.path.insert(0,${JSON.stringify(path.join(packaged.payload,runtime.repoDir))});site.addsitedir(${JSON.stringify(path.join(packaged.payload,runtime.sitePackages))});`
  const result = spawnSync(path.join(packaged.payload, runtime.storePython), ['-I', '-S', '-B', '-c', prelude + program, ...args],
    { cwd: env.HOME, env, encoding: 'utf8', timeout: 120000, maxBuffer: 2 << 20 })
  if (result.status !== 0) throw new Error(`Packaged Python failed: ${result.status}\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}

function probe(env, action) {
  const output = python(env, `import runpy;sys.argv=[${JSON.stringify(path.join(here,'probe.py'))},${JSON.stringify(action)},${JSON.stringify(inputs.backend)}];runpy.run_path(sys.argv[0],run_name='__main__')`)
  return JSON.parse(output.trim().split('\n').at(-1))
}

function writeDataFixture(origin) {
  const lock = structuredClone(inputs.original_lock)
  const pin = lock.packages[inputs.package]
  const rows = inputs.artifacts.map((row, i) => ({ url: `${origin}/engine/${i}/${row.name}`, sha256: row.sha256 }))
  pin.artifacts[inputs.target] = Array.isArray(pin.artifacts[inputs.target]) ? rows : rows[0]
  fs.writeFileSync(lockPath, JSON.stringify(lock))
  fs.writeFileSync(catalogPath, JSON.stringify({ schema_version: 3, models: [{
    id: 'recovery-tiny', display_name: 'Recovery test model', description: 'Native recovery acceptance model',
    repo: 'ggml-org/tiny-llamas', n_ctx_train: 128, full_layers: 6, recurrent_layers: 0,
    per_layer_f16: 1152, n_vocab: 32000, architecture: 'llama', quality: 1, recommend: true,
    variants: [{ quant: 'Q4_0', validated: true, files: [{ path: inputs.model_file,
      size_bytes: fs.statSync(inputs.model).size, revision: 'b2bb62b5f3af7b55f8553ed037c8b7b691250b80' }] }]
  }] }))
}

test.afterAll(() => {
  fs.writeFileSync(catalogPath, originalCatalog)
  fs.writeFileSync(lockPath, originalLock)
  for (const engine of enginePaths) if (fs.existsSync(engine+'.review-backup')) fs.renameSync(engine+'.review-backup',engine)
})

for (const scenario of ['engine-pause-resume', 'engine-discard', 'model-resume']) {
  test(`packaged native UI: ${scenario}`, async ({}, testInfo) => {
    const sandbox = createSandbox(`native-${scenario}`)
    const network = await transport(inputs)
    writeDataFixture(network.origin)
    for (const engine of enginePaths) if (fs.existsSync(engine)) fs.renameSync(engine,engine+'.review-backup')
    const env = buildAppEnv(sandbox, {
      USERPROFILE: sandbox.root, APPDATA: path.join(sandbox.root,'AppData/Roaming'),
      LOCALAPPDATA: path.join(sandbox.root,'AppData/Local'),
      HTTPS_PROXY: network.proxy, https_proxy: network.proxy,
      NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost'
    })
    for (const key of Object.keys(env)) {
      if (key.startsWith('HERMES_DESKTOP_BOOT_FAKE') || ['HERMES_DESKTOP_DEV_SERVER',
        'HERMES_DESKTOP_HERMES', 'HERMES_DESKTOP_HERMES_ROOT', 'HERMES_DESKTOP_PYTHON',
        'HERMES_PYTHON', 'PYTHONPATH', 'PYTHONHOME', 'HERMES_INSTALL_ROOT'].includes(key)) delete env[key]
    }
    fs.mkdirSync(env.APPDATA,{recursive:true}); fs.mkdirSync(env.LOCALAPPDATA,{recursive:true})
    writeMockProviderConfig(sandbox.hermesHome, network.origin)
    writeEnvFile(sandbox.hermesHome, 'e2e-inert-key', network.origin)
    let app, page
    const launches = []
    const launch = async () => {
      app = await _electron.launch({ executablePath: packaged.executable,
        args: ['--disable-gpu','--no-sandbox'], env, timeout: 90000 })
      const proof = await app.evaluate(({app}) => ({packaged:app.isPackaged, executable:process.execPath, resources:process.resourcesPath}))
      expect(proof.packaged).toBe(true)
      launches.push(proof)
      page = await app.firstWindow()
      page.on('console', message => fs.appendFileSync(testInfo.outputPath('renderer.log'), message.text()+'\n'))
      await app.context().tracing.start({ screenshots:true, snapshots:true, sources:true })
      await openSettings(page)
    }
    let trace = 0
    const stop = async () => {
      if (app) {
        await app.context().tracing.stop({path:testInfo.outputPath(`trace-${trace++}.zip`)})
        await app.close(); app = undefined
      }
      python(env, "sys.argv=['hermes','gateway','stop'];from hermes_cli.main import main;main()")
    }
    const screenshot = async name => {
      await page.screenshot({path:testInfo.outputPath(`${name}.png`)})
      const card = page.locator('h2').filter({hasText:'Recovery test model'}).locator('..')
      if (await card.count() === 1) await card.screenshot({path:testInfo.outputPath(`${name}-detail.png`)})
    }
    try {
      const files = probe(env,'paths')
      expect(files.family).toBe('recovery-tiny')
      expect(path.relative(sandbox.root, files.model).startsWith('..')).toBe(false)
      fs.mkdirSync(path.dirname(files.model),{recursive:true})
      const keep = path.join(path.dirname(files.model),'completed-keep.gguf')
      const records = []
      if (scenario === 'engine-discard') {
        for (const file of [files.model,keep]) {
          fs.copyFileSync(inputs.model,file)
          records.push({file,hash:hash(file),mtime:fs.statSync(file).mtimeMs})
        }
      }
      network.state.engine = scenario.startsWith('engine') ? 'cut' : 'healthy'
      network.state.model = scenario === 'model-resume' ? 'cut' : 'healthy'
      await launch()
      await expect(page.getByRole('button',{name:'Set up for me',exact:true})).toBeVisible({timeout:30000})
      await page.getByRole('button',{name:'Set up for me',exact:true}).click()
      if (scenario === 'engine-pause-resume') {
        await expect(page.getByText('Connection interrupted. Retrying automatically.')).toBeVisible({timeout:30000})
        await screenshot('retrying')
        await page.getByRole('button',{name:'Pause',exact:true}).click()
      }
      await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible({timeout:60000})
      const before = (await jobs(page)).find(row => row.kind === 'quickstart')
      expect(before.status).toBe('paused')
      expect(before.done_bytes).toBeGreaterThan(0)
      await screenshot('interrupted')
      const saved = fs.readdirSync(files.partials).filter(name => /\.(part|ranges)$/.test(name))
      expect(saved.length).toBeGreaterThan(0)
      await stop()
      await launch()
      await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeVisible({timeout:30000})
      const restored = (await jobs(page)).find(row => row.kind === 'quickstart')
      expect(restored.job_id).not.toBe(before.job_id)
      expect(restored.done_bytes).toBe(before.done_bytes)
      await expect(page.getByText(/Setup interrupted\. Resume to finish setup/)).toBeVisible()
      await screenshot('restored')
      if (scenario === 'engine-discard') {
        await page.getByRole('button',{name:'Discard',exact:true}).hover()
        await expect(page.getByRole('tooltip')).toContainText('Completed files will stay.')
        await screenshot('discard-explanation')
        await page.getByRole('button',{name:'Discard',exact:true}).click()
        await expect.poll(() => jobs(page)).toEqual([])
        for (const name of saved) expect(fs.existsSync(path.join(files.partials,name))).toBe(false)
        for (const record of records) {
          expect(hash(record.file)).toBe(record.hash)
          expect(fs.statSync(record.file).mtimeMs).toBe(record.mtime)
        }
        await stop(); await launch()
        expect(await jobs(page)).toEqual([])
        await screenshot('discarded-after-restart')
      } else {
        const firstResumedRequest = network.state.requests.length
        network.state.engine = 'healthy'; network.state.model = 'healthy'
        await page.getByRole('button',{name:'Resume',exact:true}).click()
        await expect.poll(async () => (await jobs(page)).find(row=>row.job_id===restored.job_id)?.status,
          {timeout:120000,intervals:[500,1000,2000]}).toBe('done')
        const result = probe(env,'complete')
        expect(result.model_sha256).toBe(inputs.model_sha256)
        fs.writeFileSync(testInfo.outputPath('native-inference.json'),JSON.stringify(result,null,2))
        await screenshot('completed')
        if (scenario === 'engine-pause-resume') {
          const requests = network.state.requests.slice(firstResumedRequest).filter(row=>row.index===0)
          expect(requests.length).toBeGreaterThan(0)
          expect(requests.every(row=>row.start>0)).toBe(true)
        } else expect(network.state.cut).toBe(true)
      }
      fs.writeFileSync(testInfo.outputPath('result.json'),JSON.stringify({scenario,launches,before,restored,
        requests:network.state.requests,connects:network.state.connects,completedFiles:records,
        source:process.env.RECOVERY_SOURCE_COMMIT},null,2))
    } finally {
      if (page && !page.isClosed()) await page.screenshot({path:testInfo.outputPath('last-state.png')}).catch(()=>{})
      await stop().catch(error=>fs.writeFileSync(testInfo.outputPath('cleanup-error.log'),String(error)))
      const logs = path.join(sandbox.hermesHome,'logs')
      if (fs.existsSync(logs)) fs.cpSync(logs,testInfo.outputPath('backend-logs'),{recursive:true})
      await network.close()
      sandbox.cleanup()
    }
  })
}
