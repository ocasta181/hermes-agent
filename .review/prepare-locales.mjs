import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(process.env.RECOVERY_SOURCE_ROOT)
const out = import.meta.dirname
const compiled = path.join(out, 'catalog.mjs')
await build({ entryPoints: [path.join(root, 'apps/desktop/src/i18n/catalog.ts')],
  bundle: true, platform: 'node', format: 'esm', outfile: compiled,
  alias: { '@': path.join(root, 'apps/desktop/src') },
  logLevel: 'silent' })
const { TRANSLATIONS } = await import(pathToFileURL(compiled).href)
function paths(value, prefix = []) {
  return Object.entries(value).flatMap(([key, child]) => typeof child === 'string'
    ? [{ path: [...prefix, key], value: child }]
    : child && typeof child === 'object' ? paths(child, [...prefix, key]) : [])
}
const english = paths(TRANSLATIONS.en)
const labels = ['Open settings', 'Providers', 'Local Models']
const nav = Object.fromEntries(labels.map(label => [label, english.filter(row => row.value === label).map(row => row.path)]))
const locales = Object.fromEntries(Object.entries(TRANSLATIONS).map(([locale, catalog]) => [locale, {
  copy: catalog.settings.localModels,
  nav: Object.fromEntries(Object.entries(nav).map(([label, choices]) => [label,
    [...new Set(choices.map(keys => keys.reduce((obj, key) => obj?.[key], catalog)).filter(value => typeof value === 'string'))]]))
}]))
fs.writeFileSync(path.join(out, 'copy.json'), JSON.stringify(locales, null, 2))
console.log(JSON.stringify({ locales: Object.keys(locales), navPaths: nav, nav: Object.fromEntries(Object.entries(locales).map(([id, value]) => [id,value.nav])) }))
