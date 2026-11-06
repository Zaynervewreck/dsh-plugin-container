import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DockerService } from '../src/host/service.js'

import { FakeSubprocess, executablePath } from './fake.js'

const CONTEXTS =
  '{"Current":true,"Description":"colima","DockerEndpoint":"unix:///Users/me/.colima/default/docker.sock","Error":"","Name":"colima"}\n' +
  '{"Current":false,"Description":"default","DockerEndpoint":"unix:///var/run/docker.sock","Error":"","Name":"default"}\n'

const VERSION = JSON.stringify({
  Client: { Version: '28.2.2', ApiVersion: '1.50', Context: 'colima', Os: 'darwin', Arch: 'arm64' },
  Server: { Version: '27.4.0', ApiVersion: '1.47', Os: 'linux', Arch: 'arm64' },
})

const INFO = JSON.stringify({
  Name: 'colima',
  ServerVersion: '27.4.0',
  OSType: 'linux',
  OperatingSystem: 'Ubuntu 24.04',
  Architecture: 'aarch64',
  NCPU: 4,
  MemTotal: 8589934592,
  Containers: 0,
  ContainersRunning: 0,
  ContainersStopped: 0,
  Images: 0,
  Driver: 'overlay2',
  DockerRootDir: '/var/lib/docker',
  ClientInfo: { Version: '28.2.2', Context: 'colima' },
})

const COLIMA_LIST = '{"name":"default","status":"Running","arch":"aarch64","cpus":4,"memory":8589934592,"disk":107374182400,"runtime":"docker"}\n'
const COLIMA_STATUS = JSON.stringify({
  display_name: 'colima',
  driver: 'macOS Virtualization.Framework',
  arch: 'aarch64',
  runtime: 'docker',
  mount_type: 'sshfs',
  docker_socket: 'unix:///Users/me/.colima/default/docker.sock',
  kubernetes: false,
  cpu: 4,
  memory: 8589934592,
  disk: 107374182400,
})

const PS = '{"ID":"abc123","Names":"web","Image":"nginx:latest","Command":"\\"nginx\\"","CreatedAt":"2026-01-01","RunningFor":"2 hours","Ports":"0.0.0.0:8080->80/tcp","Status":"Up 2 hours","State":"running","Size":"0B","Labels":"a=b"}\n'

function dockerSubcommand(spec) {
  const argv = spec.argv
  if (argv[1] === '--context') return argv[3]
  return argv[1]
}

function defaultResponder(spec, handle) {
  const sub = dockerSubcommand(spec)
  if (argv0(spec) === 'colima') {
    if (spec.argv[1] === 'list') handle.stdout.text = COLIMA_LIST
    else if (spec.argv[1] === 'status') handle.stdout.text = COLIMA_STATUS
    else handle.stdout.text = 'colima output\n'
    return { exitCode: 0, signal: null }
  }
  if (sub === 'context') {
    handle.stdout.text = CONTEXTS
    return { exitCode: 0, signal: null }
  }
  if (sub === 'version') {
    handle.stdout.text = VERSION
    return { exitCode: 0, signal: null }
  }
  if (sub === 'info') {
    handle.stdout.text = INFO
    return { exitCode: 0, signal: null }
  }
  if (sub === 'ps') {
    handle.stdout.text = PS
    return { exitCode: 0, signal: null }
  }
  if (sub === 'inspect' || sub === 'container') {
    handle.stdout.text = '[{"Id":"abc123","Name":"/web"}]'
    return { exitCode: 0, signal: null }
  }
  if (sub === 'compose') {
    handle.stdout.text = '[]'
    return { exitCode: 0, signal: null }
  }
  if (sub === 'system') {
    handle.stdout.text = '{"Type":"Images","TotalCount":0,"ActiveCount":0,"Size":"0B","Reclaimable":"0B"}\n'
    return { exitCode: 0, signal: null }
  }
  if (sub === 'events') return undefined
  handle.stdout.text = ''
  return { exitCode: 0, signal: null }
}

function argv0(spec) {
  return spec.argv[0] === '/bin/sh' ? 'colima' : 'docker'
}

function makeService(respond = defaultResponder, config = {}) {
  const subprocess = new FakeSubprocess(respond)
  const service = new DockerService({
    subprocess,
    platform: 'darwin',
    home: '/tmp',
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
    config: {
      dockerPath: executablePath,
      colimaPath: '/bin/sh',
      enableRuntimeControl: true,
      ...config,
    },
  })
  return { service, subprocess }
}

const owner = { principal: { kind: 'owner' } }

test('status composes CLI, daemon, context, and colima details', async () => {
  const { service, subprocess } = makeService()
  const result = await service.handle('status', {}, undefined, owner)
  assert.equal(result.ok, true)
  assert.equal(result.value.cli.installed, true)
  assert.equal(result.value.cli.version, '28.2.2')
  assert.equal(result.value.daemon.state, 'running')
  assert.equal(result.value.context.selected, 'colima')
  assert.equal(result.value.runtime.kind, 'colima')
  assert.equal(result.value.runtime.profile, 'default')
  assert.equal(result.value.runtime.running, true)
  assert.equal(result.value.runtime.cpus, 4)
  assert.equal(result.value.server.ncpu, 4)
  assert.equal(result.value.server.memTotal, 8589934592)
  assert.ok(subprocess.specs.some((spec) => spec.argv.includes('--context') && spec.argv.includes('info')))
  service.dispose()
})

test('list parses containers and is context-aware', async () => {
  const { service, subprocess } = makeService()
  const result = await service.handle('list', { resource: 'containers', context: 'colima', all: true }, undefined, owner)
  assert.equal(result.ok, true)
  assert.equal(result.value.items.length, 1)
  assert.equal(result.value.items[0].name, 'web')
  assert.deepEqual(result.value.items[0].ports, ['0.0.0.0:8080->80/tcp'])
  const spec = subprocess.specs.find((candidate) => candidate.argv.includes('ps'))
  assert.deepEqual(spec.argv.slice(0, 4), [executablePath, '--context', 'colima', 'ps'])
  service.dispose()
})

test('run requires confirmation for destructive commands and honors it', async () => {
  const { service, subprocess } = makeService()
  const denied = await service.handle('run', { command: 'rm -f missing', context: 'colima' }, undefined, owner)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'docker/confirmation-required')
  assert.equal(subprocess.specs.some((spec) => spec.argv.includes('rm')), false)

  const accepted = await service.handle('run', { command: 'rm -f missing', context: 'colima', confirm: true }, undefined, owner)
  assert.equal(accepted.ok, true)
  assert.equal(accepted.value.run.status, 'running')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const polled = await service.handle('poll', { runId: accepted.value.run.id }, undefined, owner)
  assert.equal(polled.ok, true)
  assert.equal(polled.value.run.status, 'exited')
  service.dispose()
})

test('run injects context, validates cwd, and reports unknown contexts', async () => {
  const { service, subprocess } = makeService()
  const accepted = await service.handle('run', { command: 'ps -a', context: 'colima' }, undefined, owner)
  assert.equal(accepted.ok, true)
  const spec = subprocess.specs.find((candidate) => candidate.argv.includes('ps') && candidate.argv.includes('-a'))
  assert.deepEqual(spec.argv, [executablePath, '--context', 'colima', 'ps', '-a'])

  const badCwd = await service.handle('run', { command: 'ps', cwd: '/definitely/missing' }, undefined, owner)
  assert.equal(badCwd.ok, false)
  assert.equal(badCwd.error.code, 'docker/invalid-cwd')

  const badContext = await service.handle('list', { resource: 'containers', context: 'nope' }, undefined, owner)
  assert.equal(badContext.ok, false)
  assert.equal(badContext.error.code, 'docker/context-unknown')
  service.dispose()
})

test('cancel stops a running event stream', async () => {
  const { service } = makeService()
  const accepted = await service.handle('run', { command: 'events', context: 'colima' }, undefined, owner)
  assert.equal(accepted.ok, true)
  const cancelled = await service.handle('cancel', { runId: accepted.value.run.id }, undefined, owner)
  assert.equal(cancelled.ok, true)
  assert.equal(cancelled.value.status, 'cancelling')
  await new Promise((resolve) => setTimeout(resolve, 20))
  const polled = await service.handle('poll', { runId: accepted.value.run.id }, undefined, owner)
  assert.equal(polled.value.run.status, 'cancelled')
  service.dispose()
})

test('inspect and disk/list resources return parsed values', async () => {
  const { service } = makeService()
  const inspected = await service.handle('inspect', { kind: 'container', id: 'abc123', context: 'colima' }, undefined, owner)
  assert.equal(inspected.ok, true)
  assert.equal(inspected.value.value.Id, 'abc123')
  const disk = await service.handle('list', { resource: 'disk', context: 'colima' }, undefined, owner)
  assert.equal(disk.ok, true)
  assert.equal(disk.value.items[0].type, 'Images')
  service.dispose()
})

test('non-owner peers are refused', async () => {
  const { service } = makeService()
  const result = await service.handle('status', {}, undefined, { principal: { kind: 'api' } })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'docker/forbidden')
  service.dispose()
})

test('daemon stopped and missing CLI keep status useful', async () => {
  const stoppedResponder = (spec, handle) => {
    const sub = dockerSubcommand(spec)
    if (argv0(spec) === 'colima') {
      if (spec.argv[1] === 'list') handle.stdout.text = '{"name":"default","status":"Stopped","arch":"aarch64","cpus":4,"memory":8589934592,"disk":107374182400,"runtime":"docker"}\n'
      return { exitCode: 0, signal: null }
    }
    if (sub === 'context') {
      handle.stdout.text = CONTEXTS
      return { exitCode: 0, signal: null }
    }
    if (sub === 'version') {
      handle.stdout.text = JSON.stringify({ Client: { Version: '28.2.2', Context: 'colima' } })
      return { exitCode: 0, signal: null }
    }
    handle.stderr.text = 'Cannot connect to the Docker daemon at unix:///x. Is the docker daemon running?\n'
    return { exitCode: 1, signal: null }
  }
  const stopped = makeService(stoppedResponder)
  const result = await stopped.service.handle('status', {}, undefined, owner)
  assert.equal(result.ok, true)
  assert.equal(result.value.daemon.state, 'stopped')
  assert.equal(result.value.runtime.kind, 'colima')
  assert.equal(result.value.runtime.canStart, true)
  stopped.service.dispose()

  const missing = makeService(stoppedResponder, { dockerPath: '/definitely/missing', colimaPath: '/definitely/missing' })
  const missingResult = await missing.service.handle('status', {}, undefined, owner)
  assert.equal(missingResult.ok, true)
  assert.equal(missingResult.value.cli.installed, false)
  missing.service.dispose()
})

test('runtimeAction starts colima as a job and validates confirmation', async () => {
  const { service } = makeService()
  const denied = await service.handle('runtimeAction', { action: 'stop', context: 'colima' }, undefined, owner)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'docker/confirmation-required')
  const started = await service.handle('runtimeAction', { action: 'start', context: 'colima' }, undefined, owner)
  assert.equal(started.ok, true)
  assert.equal(started.value.dispatched, true)
  assert.equal(started.value.run.displayCommand.includes('colima start'), true)
  service.dispose()
})

test('semantic actions map to Docker argv without UI-specific syntax', async () => {
  const { service, subprocess } = makeService()
  const logs = await service.handle('action', { kind: 'container', action: 'logs', id: 'web' }, undefined, owner)
  assert.equal(logs.ok, true)
  assert.equal(logs.value.run.id.startsWith('docker_'), true)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'logs', '--tail', '500', 'web'])

  const pull = await service.handle('action', { kind: 'image', action: 'pull', id: 'alpine:latest' }, undefined, owner)
  assert.equal(pull.ok, true)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'pull', 'alpine:latest'])

  const denied = await service.handle('action', { kind: 'container', action: 'delete', id: 'web' }, undefined, owner)
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'docker/confirmation-required')
  const removed = await service.handle('action', { kind: 'container', action: 'delete', id: 'web', confirm: true }, undefined, owner)
  assert.equal(removed.ok, true)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'rm', '-f', 'web'])
})

test('run-container action builds detached Docker argv with ports and env', async () => {
  const { service, subprocess } = makeService()
  const result = await service.handle('action', {
    kind: 'container',
    action: 'run',
    image: 'nginx:latest',
    name: 'web',
    command: 'sh -c "echo hi"',
    ports: ['8080:80'],
    env: ['A=B'],
  }, undefined, owner)
  assert.equal(result.ok, true)
  assert.deepEqual(subprocess.specs.at(-1).argv, [
    executablePath, '--context', 'colima',
    'run', '-d', '-i', '-t', '--name', 'web', '-p', '8080:80', '-e', 'A=B',
    'nginx:latest', 'sh', '-c', 'echo hi',
  ])
})

test('image list enriches architecture from image inspect', async () => {
  const contexts = CONTEXTS
  const responder = (spec, handle) => {
    const args = spec.argv
    const sub = args[1] === '--context' ? args[3] : args[1]
    if (sub === 'context') {
      handle.stdout.text = contexts
      return { exitCode: 0, signal: null }
    }
    if (sub === 'images') {
      handle.stdout.text = '{"ID":"abc123","Repository":"nginx","Tag":"latest","Size":"183MB","CreatedAt":"2026-01-01"}\n'
      return { exitCode: 0, signal: null }
    }
    if (sub === 'image' && args[4] === 'inspect') {
      handle.stdout.text = '{"Id":"sha256:abc123def456","Os":"linux","Architecture":"arm64","Variant":"v8"}\n'
      return { exitCode: 0, signal: null }
    }
    handle.stdout.text = ''
    return { exitCode: 0, signal: null }
  }
  const { service } = makeService(responder)
  const result = await service.handle('list', { resource: 'images', context: 'colima' }, undefined, owner)
  assert.equal(result.ok, true)
  assert.equal(result.value.items[0].architecture, 'linux/arm64/v8')
  service.dispose()
})

test('exec mode starts docker exec PTY instead of attach', async () => {
  const responder = (spec, handle) => {
    if (spec.argv.includes('inspect')) {
      handle.stdout.text = 'true'
      return { exitCode: 0, signal: null }
    }
    return defaultResponder(spec, handle)
  }
  const { service } = makeService(responder)
  let captured
  service.attach.start = async (input) => {
    captured = input
    return { id: 'attach_test', status: 'running', mode: input.mode }
  }
  const result = await service.handle('attach', {
    provider: 'docker',
    context: 'colima',
    id: 'web',
    mode: 'exec',
  }, undefined, owner)
  assert.equal(result.ok, true)
  assert.equal(captured.mode, 'exec')
  assert.deepEqual(captured.argv, [
    executablePath, '--context', 'colima', 'exec', '-i', '-t', 'web', '/bin/sh',
  ])
  service.dispose()
})

test('image push and build map to docker CLI actions', async () => {
  const { service, subprocess } = makeService()
  const push = await service.action({ kind: 'image', action: 'push', id: 'nginx:latest' }, undefined)
  assert.equal(push.run.status === 'running' || push.run.status === 'exited', true)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'push', 'nginx:latest'])

  const build = await service.action({
    kind: 'image',
    action: 'build',
    tag: 'my-app:latest',
    contextPath: '/tmp',
    dockerfile: 'Dockerfile',
    noCache: true,
  }, undefined)
  assert.equal(build.run.status === 'running' || build.run.status === 'exited', true)
  assert.deepEqual(subprocess.specs.at(-1).argv, [
    executablePath, '--context', 'colima',
    'build', '--progress', 'plain', '-t', 'my-app:latest', '-f', 'Dockerfile', '--no-cache', '/tmp',
  ])
  service.dispose()
})
