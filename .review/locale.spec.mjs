import { _electron, expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import http from 'node:http'
import { packagePaths } from './package.mjs'

const root = path.resolve(process.env.RECOVERY_SOURCE_ROOT)
const { createSandbox, buildAppEnv } = await import(pathToFileURL(path.join(root,'apps/desktop/e2e/fixtures.ts')).href)
const { writeMockProviderConfig, writeEnvFile } = await import(pathToFileURL(path.join(root,'tests-js/scripts/mock-provider-config.ts')).href)
const packaged = packagePaths(root)
const runtime = JSON.parse(fs.readFileSync(path.join(packaged.payload,'manifest.json'))).runtime
function python(env, program, args=[]) {
  const prelude = `import sys,site;sys.path.insert(0,${JSON.stringify(path.join(packaged.payload,runtime.repoDir))});site.addsitedir(${JSON.stringify(path.join(packaged.payload,runtime.sitePackages))});`
  const result = spawnSync(path.join(packaged.payload,runtime.storePython),['-I','-S','-B','-c',prelude+program,...args],
    {cwd:env.HOME,env,encoding:'utf8',timeout:20000,maxBuffer:2<<20})
  if(result.status!==0) throw Error(result.stderr || result.stdout)
  return result.stdout.trim().split('\n').at(-1)
}
const jobs = page => page.evaluate(async()=> (await window.hermesDesktop.api({path:'/api/local-models/jobs'})).jobs)
for(const locale of (process.env.REVIEW_LOCALES??process.env.REVIEW_LOCALE).split(',')) {
const {copy,nav} = JSON.parse(fs.readFileSync(new URL('./copy.json',import.meta.url)))[locale]
test(`packaged recovery controls: ${locale}`,async({},info)=>{
  const sandbox = createSandbox(`native-locale-${locale}`)
  fs.writeFileSync(info.outputPath('sandbox.json'),JSON.stringify(sandbox))
  const env = buildAppEnv(sandbox)
  for(const key of Object.keys(env)) if(key.startsWith('HERMES_DESKTOP_BOOT_FAKE') ||
    ['HERMES_DESKTOP_DEV_SERVER','HERMES_DESKTOP_HERMES','HERMES_DESKTOP_HERMES_ROOT',
     'HERMES_DESKTOP_PYTHON','HERMES_PYTHON','PYTHONPATH','PYTHONHOME','HERMES_INSTALL_ROOT'].includes(key)) delete env[key]
  let app,page
  const requests=[]
  const block = 1<<20
  const server = http.createServer((request,response)=>{
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range??'')
    if(!range) {response.writeHead(400).end();return}
    const start=Number(range[1]),end=Number(range[2])
    if(start!==0 || end!==0) {requests.push({path:request.url,start,end});response.writeHead(503).end();return}
    const total=request.url==='/companion'?15:4*block
    response.writeHead(206,{'Content-Range':`bytes 0-0/${total}`,'Content-Length':1,ETag:'"recovery-fixture-v1"'}).end('w')
  })
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    const origin=`http://127.0.0.1:${server.address().port}`
    writeMockProviderConfig(sandbox.hermesHome,origin,`language: ${locale}\n`)
    writeEnvFile(sandbox.hermesHome,'e2e-inert-key',origin)
    const seed=JSON.parse(python(env,`
import json,hashlib
from hermes_cli.local_runtime import bootstrap,catalog,download_plans
from pm.paths import partials_root
entry=catalog.CATALOG[0]
models=bootstrap.models_dir();models.mkdir(parents=True)
first=models/'completed.gguf';first.write_bytes(b'completed first shard')
second=models/(entry.variants[0].model_id+'.gguf')
asset=bootstrap.assets_dir()/'companion.gguf'
url=sys.argv[1]+'/weights';block=1<<20
root=partials_root();root.mkdir(parents=True)
key=hashlib.sha256(url.encode()).hexdigest()
part=root/(key+'.part');side=root/(key+'.ranges')
with part.open('wb') as stream:
 stream.truncate(4*block);stream.write(b'w'*block)
side.write_text(json.dumps({'total':4*block,'etag':'"recovery-fixture-v1"','sha256':'','ranges':[[0,block]]}))
download_plans.save_plan({'target':entry.display_name,'model_id':entry.id},[(sys.argv[1]+'/complete',first,first.stat().st_size),(url,second,4*block),(sys.argv[1]+'/companion',asset,15)])
print(json.dumps({'first':str(first),'part':str(part),'side':str(side),'model':entry.display_name}))
`,[origin]))
    const firstTime=fs.statSync(seed.first).mtimeMs
    app=await _electron.launch({executablePath:packaged.executable,args:['--disable-gpu','--no-sandbox'],env,timeout:45000})
    expect(await app.evaluate(({app})=>app.isPackaged)).toBe(true)
    page=await app.firstWindow()
    await page.emulateMedia({reducedMotion:'reduce'})
    page.on('console',message=>fs.appendFileSync(info.outputPath('renderer.log'),message.text()+'\n'))
    for(const name of ['Open settings','Providers','Local Models']) {
      const expression=new RegExp(`^(?:${nav[name].map(value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})$`)
      await page.getByRole('button',{name:expression}).click({timeout:45000})
    }
    const language=await page.locator('html').getAttribute('lang')
    const direction=await page.locator('html').getAttribute('dir')
    expect(language.toLowerCase()).toBe(locale)
    expect(direction).toBe(locale==='ar'?'rtl':'ltr')
    const resume=page.getByRole('button',{name:copy.downloadResumeAction,exact:true})
    const discard=page.getByRole('button',{name:copy.downloadDiscardAction,exact:true})
    await expect(resume).toBeVisible({timeout:15000})
    await expect(page.getByText(copy.downloadInterruptedLabel,{exact:false})).toBeVisible()
    const before=(await jobs(page))[0]
    expect(before.done_bytes).toBe(block+fs.statSync(seed.first).size)
    await page.screenshot({path:info.outputPath('restored.png')})
    await resume.click()
    await expect(page.getByText(copy.downloadRetryingLabel,{exact:false})).toBeVisible({timeout:10000})
    expect(requests.length).toBeGreaterThan(0)
    await page.getByRole('button',{name:copy.downloadPauseAction,exact:true}).click()
    await expect(resume).toBeVisible({timeout:5000})
    await expect(page.getByText(copy.downloadPausedLabel,{exact:true})).toBeVisible()
    await expect(page.getByText(copy.downloadRetryingLabel,{exact:false})).toBeHidden()
    await discard.hover()
    const tooltip=page.getByRole('tooltip')
    await expect(tooltip).toContainText(copy.downloadDiscardDetail)
    const geometry=await page.locator('button').filter({hasText:new RegExp(`^(?:${[copy.downloadResumeAction,copy.downloadDiscardAction].join('|')})$`)}).evaluateAll(elements=>elements.map(el=>{
      const b=el.getBoundingClientRect();return {text:el.textContent,x:b.x,y:b.y,width:b.width,height:b.height,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,viewportWidth:innerWidth,viewportHeight:innerHeight}
    }))
    expect(geometry).toHaveLength(2)
    for(const box of geometry) {
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x+box.width).toBeLessThanOrEqual(box.viewportWidth)
      expect(box.y+box.height).toBeLessThanOrEqual(box.viewportHeight)
      expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth+1)
    }
    await page.screenshot({path:info.outputPath('discard-explanation.png')})
    await discard.click()
    await expect.poll(()=>jobs(page),{timeout:5000}).toEqual([])
    expect(fs.existsSync(seed.part)).toBe(false);expect(fs.existsSync(seed.side)).toBe(false)
    expect(fs.readFileSync(seed.first,'utf8')).toBe('completed first shard')
    expect(fs.statSync(seed.first).mtimeMs).toBe(firstTime)
    const result={locale,language,direction,packaged:true,controls:geometry,requests,
      checks:['restored progress','localized recovery explanation','Resume reaches HTTP 503','localized retry status','Pause retains recovery controls','localized Discard tooltip','visible unclipped recovery buttons','Discard removes partial files','Discard preserves completed file and mtime']}
    fs.writeFileSync(info.outputPath('result.json'),JSON.stringify(result,null,2))
  } finally {
    fs.writeFileSync(info.outputPath('requests.json'),JSON.stringify(requests))
    if(page && !page.isClosed()) await page.screenshot({path:info.outputPath('last-state.png')}).catch(()=>{})
    await app?.close()
    const cleanup=python(env,`import runpy;runpy.run_path(${JSON.stringify(path.join(import.meta.dirname,'cleanup.py'))},run_name='__main__')`)
    fs.writeFileSync(info.outputPath('cleanup.json'),cleanup)
    const logs=path.join(sandbox.hermesHome,'logs')
    if(fs.existsSync(logs)) fs.cpSync(logs,info.outputPath('backend-logs'),{recursive:true})
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve))
    sandbox.cleanup()
  }
})
}
