// Transport faults only. Actual archives, PM installation, and inference remain real.
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export async function transport(inputs) {
  const state = { engine: 'healthy', model: 'healthy', requests: [], modelRequests: [], connects: [], cut: false }
  const sockets = new Set()
  const tls = fs.mkdtempSync(path.join(os.tmpdir(),'hermes-recovery-tls-'))
  const caFile = path.join(tls,'ca.pem')
  fs.writeFileSync(path.join(tls,'ca.cnf'),`[req]
distinguished_name=dn
x509_extensions=ca
prompt=no
[dn]
CN=Recovery integration test CA
[ca]
basicConstraints=critical,CA:TRUE
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid:always,issuer
`)
  fs.writeFileSync(path.join(tls,'leaf.cnf'),`basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
subjectAltName=DNS:huggingface.co,DNS:us.aws.cdn.hf.co
`)
  const openssl=args=>execFileSync('/usr/bin/openssl',args,{cwd:tls,stdio:'ignore'})
  openssl(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-config','ca.cnf','-keyout','ca.key','-out','ca.pem'])
  openssl(['req','-new','-newkey','rsa:2048','-nodes','-sha256','-subj','/CN=huggingface.co','-keyout','leaf.key','-out','leaf.csr'])
  openssl(['x509','-req','-in','leaf.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','1','-sha256','-extfile','leaf.cnf','-out','leaf.pem'])
  const modelServer = https.createServer({key:fs.readFileSync(path.join(tls,'leaf.key')),cert:fs.readFileSync(path.join(tls,'leaf.pem'))},(req,res)=>{
    const size=fs.statSync(inputs.model).size
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range??'')
    const start=match?Number(match[1]):0
    const end=match&&match[2]?Math.min(Number(match[2]),size-1):size-1
    if(start!==0||end!==0) state.modelRequests.push({start,end,mode:state.model})
    res.writeHead(match?206:200,{'Content-Length':end-start+1,'Accept-Ranges':'bytes',
      ...(match?{'Content-Range':`bytes ${start}-${end}/${size}`} : {}),ETag:`"${inputs.model_sha256}"`})
    fs.createReadStream(inputs.model,{start,end}).pipe(res)
  })
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', object: 'model' }] }))
      return
    }
    const index = Number(/^\/engine\/(\d+)\//.exec(req.url ?? '')?.[1])
    const artifact = inputs.artifacts[index]
    if (!artifact) { res.writeHead(404).end(); return }
    const size = fs.statSync(artifact.path).size
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '')
    const start = match ? Number(match[1]) : 0
    const end = match && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
    const probe = start === 0 && end === 0
    if (!probe) state.requests.push({ index, start, end, mode: state.engine })
    if (!probe && state.engine === 'blocked') {
      // Let the first response's real bytes reach disk before a parallel
      // sibling's 503 cancels the in-flight readers.
      setTimeout(() => res.writeHead(503).end(), 500)
      return
    }
    res.writeHead(match ? 206 : 200, {
      'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      ETag: `"${artifact.sha256}"`
    })
    if (!probe && state.engine === 'cut') {
      state.engine = 'blocked'
      state.cutRange = { index, start, end: Math.min(end + 1, start + (1 << 20)) }
      const stream = fs.createReadStream(artifact.path, { start, end: Math.min(end, start + (1 << 20) - 1) })
      stream.pipe(res, { end: false })
      stream.on('end', () => setTimeout(() => res.destroy(), 100))
    } else fs.createReadStream(artifact.path, { start, end }).pipe(res)
  })
  const proxy = http.createServer((_, res) => res.writeHead(503).end())
  proxy.on('connect', (req, client, head) => {
    const [host, port] = req.url.split(':')
    const allowed = /(^|\.)(huggingface\.co|hf\.co)$/.test(host)
    state.connects.push({ host, mode: state.model, allowed })
    if (!allowed || state.model === 'blocked') {
      setTimeout(() => client.end('HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\n\r\n'), 500)
      return
    }
    const remote = net.connect(modelServer.address().port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) remote.write(head)
      client.pipe(remote)
      let bytes = 0
      remote.on('data', data => {
        bytes += data.length
        client.write(data)
        if (state.model === 'cut' && bytes > 2 << 20) {
          state.model = 'blocked'
          state.cut = true
          remote.destroy()
          client.destroy()
        }
      })
      remote.on('end', () => client.end())
    })
    remote.on('error', () => client.destroy())
    client.on('error', () => remote.destroy())
    client.on('close', () => remote.destroy())
    sockets.add(remote)
    remote.on('close', () => sockets.delete(remote))
  })
  for (const srv of [server, modelServer, proxy]) {
    srv.on('connection', socket => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
    })
    await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  }
  return { state, caFile, origin: `http://127.0.0.1:${server.address().port}`,
    proxy: `http://127.0.0.1:${proxy.address().port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await Promise.all([server, modelServer, proxy].map(srv => new Promise(resolve => srv.close(resolve))))
      fs.rmSync(tls,{recursive:true,force:true})
    }
  }
}
