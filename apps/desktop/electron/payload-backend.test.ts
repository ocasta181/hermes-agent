import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test, vi } from 'vitest'

import type { InstallStamp, PayloadRuntime } from './install-stamp'
import { bundledPayload, installIdForRoot, payloadPythonPath, payloadTicketRuntime } from './payload-backend'

function stamp(runtime: PayloadRuntime, payload: InstallStamp['payload'] = 'bundled'): InstallStamp {
  return {
    schemaVersion: 1,
    commit: 'a'.repeat(40),
    commitDate: null,
    branch: null,
    builtAt: null,
    dirty: false,
    source: 'ci',
    distribution: 'desktop-app',
    updateMechanism: 'external',
    baseVersion: null,
    displayVersion: null,
    distance: null,
    payload,
    runtime,
    tag: 'v1.0.0'
  }
}

test('bundled launch paths come from build metadata without filesystem access', () => {
  const runtime: PayloadRuntime = {
    repoDir: 'source-tree',
    toolsDir: 'binary-store',
    storePython: 'binary-store/custom-python/python',
    sitePackages: 'dependencies/lib/python3.14/site-packages',
    commands: { hermes: 'commands/run-hermes', custom: 'commands/custom' }
  }

  const probe = vi.spyOn(fs, 'existsSync').mockImplementation(() => {
    throw new Error('runtime probe')
  })

  const read = vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
    throw new Error('runtime read')
  })

  try {
    for (const resources of ['/not-created/resources', '/relocated app/resources']) {
      const result = bundledPayload(resources, stamp(runtime))
      assert.ok(result)
      assert.equal(result.storePython, path.join(resources, 'agent-payload', runtime.storePython))
      assert.equal(result.sitePackages, path.join(resources, 'agent-payload', runtime.sitePackages))
      assert.equal(result.shim, result.commands.hermes)
      assert.equal(result.commands.custom, path.join(resources, 'agent-payload', runtime.commands.custom))
    }

    assert.equal(probe.mock.calls.length, 0)
    assert.equal(read.mock.calls.length, 0)
    assert.equal(bundledPayload('/resources', stamp(runtime, 'light')), null)
    assert.equal(bundledPayload('/resources', stamp(runtime, 'bootstrap')), null)
    assert.equal(bundledPayload('/resources', null), null)
  } finally {
    probe.mockRestore()
    read.mockRestore()
  }
})

// ─── update channel helpers ─────────────────────────────────────────

test('installIdForRoot matches the Python install id (sha16 of the canonical path)', () => {
  // sha256('/home/u/.hermes/hermes-agent')[:16] — recomputed independently.
  assert.equal(
    installIdForRoot('/home/u/.hermes/hermes-agent'),
    createHash('sha256').update('/home/u/.hermes/hermes-agent', 'utf8').digest('hex').slice(0, 16)
  )
  // The canonicalizer output is what gets hashed (symlinked homes).
  assert.equal(
    installIdForRoot('/link/hermes-agent', () => '/real/hermes-agent'),
    installIdForRoot('/real/hermes-agent')
  )
})

test('bundled core code precedes the dependencies, as the bin launchers order them', () => {
  assert.equal(
    payloadPythonPath({ repoDir: 'payload/hermes-agent', sitePackages: 'payload/venv/site-packages' }),
    ['payload/hermes-agent', 'payload/venv/site-packages'].join(path.delimiter)
  )
})

test('bundled ticket code runs in the declared interpreter with its own import roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'payload-ticket-'))
  const repo = path.join(root, 'repo')
  const site = path.join(root, 'dependencies')
  fs.mkdirSync(repo)
  fs.mkdirSync(site)
  fs.writeFileSync(path.join(repo, 'ticket_owner.py'), 'value = "payload"')
  fs.writeFileSync(path.join(site, 'ticket_owner.py'), 'value = "stale"')
  fs.writeFileSync(path.join(site, 'ticket_dependency.py'), 'value = "dependency"')

  try {
    const backend = { command: process.execPath, env: { PYTHONPATH: '/foreign-install', PYTHONHOME: '' } }

    assert.equal(payloadTicketRuntime(backend, null), backend)

    const runtime = payloadTicketRuntime(backend, { root, repoDir: repo, sitePackages: site, toolsDir: root,
      storePython: process.env.HERMES_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
      commands: { hermes: process.execPath }, shim: process.execPath })

    const output = execFileSync(runtime.command, ['-P', '-c',
      'import ticket_owner, ticket_dependency; print(ticket_owner.value, ticket_dependency.value)'],
    { env: { ...process.env, ...runtime.env }, encoding: 'utf8', timeout: 10_000 })

    assert.equal(output.trim(), 'payload dependency')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
