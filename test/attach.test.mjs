import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { test } from 'node:test'

import { AttachManager } from '../src/host/attach.js'

class FakeTerminal {
  constructor() {
    this.output = new PassThrough()
    this.written = []
    this.resized = []
    this.terminated = false
    this.done = new Promise((resolve) => { this.resolve = resolve })
  }
  write(data) { this.written.push(data) }
  async resize(cols, rows) { this.resized.push([cols, rows]) }
  async terminate() {
    this.terminated = true
    this.output.end()
    this.resolve({ exitCode: 0, signal: null })
  }
}

class FakeTerminalSubprocess {
  async spawnTerminal(spec) {
    this.spec = spec
    this.handle = new FakeTerminal()
    return this.handle
  }
}

test('attach manager streams PTY output, accepts input, resizes, and closes', async () => {
  const subprocess = new FakeTerminalSubprocess()
  const manager = new AttachManager({ subprocess, maxBytes: 64 * 1024 })
  const value = await manager.start({
    argv: ['docker', 'attach', 'web'],
    cwd: '/tmp',
    env: { PATH: '/usr/bin' },
    provider: 'docker',
    containerId: 'web',
    containerName: 'web',
    command: 'docker attach web',
    cols: 100,
    rows: 30,
  })
  assert.equal(value.status, 'running')
  assert.equal(value.cols, 100)
  assert.deepEqual(subprocess.spec.argv, ['docker', 'attach', 'web'])

  subprocess.handle.output.write('hello\r\n')
  await new Promise((resolve) => setImmediate(resolve))
  const first = manager.poll({ attachId: value.id, offset: 0 })
  assert.equal(first.output.text, 'hello\r\n')
  assert.equal(first.output.nextOffset, 7)

  const empty = manager.poll({ attachId: value.id, offset: first.output.nextOffset })
  assert.equal(empty.output.text, '')

  await manager.write({ attachId: value.id, data: 'echo ok\r' })
  assert.deepEqual(subprocess.handle.written, ['echo ok\r'])
  await manager.resize({ attachId: value.id, cols: 120, rows: 40 })
  assert.deepEqual(subprocess.handle.resized, [[120, 40]])

  const closed = await manager.close({ attachId: value.id })
  assert.equal(closed.status, 'closed')
  assert.equal(subprocess.handle.terminated, true)
  assert.throws(() => manager.poll({ attachId: value.id, offset: 0 }), (error) => error.code === 'docker/attach-unknown')
})

test('attach manager reports lossy offsets and enforces input limits', async () => {
  const subprocess = new FakeTerminalSubprocess()
  const manager = new AttachManager({ subprocess, maxBytes: 64 * 1024 })
  const value = await manager.start({
    argv: ['x'], cwd: '/tmp', provider: 'docker', containerId: 'x', containerName: 'x', command: 'x',
  })
  subprocess.handle.output.write(`${'a'.repeat(64 * 1024)}TAIL`)
  await new Promise((resolve) => setImmediate(resolve))
  const polled = manager.poll({ attachId: value.id, offset: 0 })
  assert.equal(polled.output.lossy, true)
  assert.equal(polled.output.text.endsWith('TAIL'), true)
  assert.equal(polled.output.text.length, 64 * 1024)
  await assert.rejects(() => manager.write({ attachId: value.id, data: 'x'.repeat(9000) }), (error) => error.code === 'docker/attach-input')
  await manager.close({ attachId: value.id })
})
