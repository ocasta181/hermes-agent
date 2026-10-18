import fs from 'node:fs'
import path from 'node:path'

export function packagePaths(root) {
  const release = path.join(root, 'apps/desktop/release')
  const directory = process.platform === 'darwin' ? `mac-${process.arch}`
    : process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked'
  const unpacked = path.join(release, directory)
  const app = process.platform === 'darwin' ? path.join(unpacked, fs.readdirSync(unpacked).find(name=>name.endsWith('.app'))) : unpacked
  const resources = path.join(app, process.platform === 'darwin' ? 'Contents/Resources' : 'resources')
  const main = process.platform === 'darwin'
    ? fs.readdirSync(path.join(app,'Contents/MacOS'))
    : fs.readdirSync(app).filter(name => process.platform === 'win32'
      ? name.endsWith('.exe') && name !== 'chrome_crashpad_handler.exe'
      : !name.includes('.') && !name.startsWith('chrome') && fs.statSync(path.join(app,name)).isFile()
        && fs.readFileSync(path.join(app,name)).subarray(0,4).equals(Buffer.from([127,69,76,70])))
  if (main.length !== 1) throw new Error(`Ambiguous packaged executable: ${main}`)
  const executable = path.join(app, process.platform === 'darwin' ? 'Contents/MacOS' : '', main[0])
  if (!fs.existsSync(executable)) throw new Error(`Packaged executable missing: ${executable}`)
  return { app, executable, payload: path.join(resources, 'agent-payload') }
}

if (process.argv[1] === import.meta.filename) {
  console.log(JSON.stringify(packagePaths(path.resolve(process.argv[2]))))
}
