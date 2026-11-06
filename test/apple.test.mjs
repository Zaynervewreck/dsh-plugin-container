import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AppleProvider } from '../src/host/apple.js'
import { DockerService } from '../src/host/service.js'

import { FakeSubprocess, executablePath } from './fake.js'

const CONTAINERS = [{
  configuration: {
    id: 'web',
    creationDate: '2026-11-04T09:06:14Z',
    image: { reference: 'docker.io/library/nginx:latest' },
    initProcess: { executable: 'nginx', arguments: ['-g', 'daemon off;'] },
    labels: { app: 'web' },
    mounts: [],
    networks: [{ network: 'default' }],
    publishedPorts: [{ hostAddress: '0.0.0.0', hostPort: 8080, containerPort: 80, protocol: 'tcp' }],
  },
  id: 'web',
  status: { state: 'running', startedDate: '2026-11-04T09:06:16Z' },
}]

const IMAGES = [{
  id: 'sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b',
  configuration: { name: 'docker.io/library/alpine:latest', creationDate: '2026-06-16T00:01:20Z' },
  variants: [{ size: 4184689, platform: { os: 'linux', architecture: 'arm64', variant: 'v8' } }],
}]

const VOLUMES = [{
  id: 'data',
  configuration: { name: 'data', driver: 'local', format: 'ext4', creationDate: '2026-11-04T09:07:41Z', sizeInBytes: 1024, source: '/tmp/data' },
}]

const NETWORKS = [{
  id: 'default',
  configuration: { name: 'default', mode: 'nat', plugin: 'container-network-vmnet', creationDate: '2026-06-26T06:05:00Z' },
  status: { ipv4Subnet: '192.168.64.0/24', ipv6Subnet: 'fdab::/64' },
}]

const DF = {
  containers: { active: 1, reclaimable: 0, sizeInBytes: 268075008, total: 1 },
  images: { active: 1, reclaimable: 240021504, sizeInBytes: 322924544, total: 2 },
  volumes: { active: 0, reclaimable: 0, sizeInBytes: 0, total: 1 },
}

const STATUS = {
  apiServerAppName: 'container-apiserver',
  apiServerBuild: 'release',
  apiServerCommit: 'unspecified',
  apiServerVersion: 'container-apiserver version 1.0.0',
  appRoot: '/tmp/app',
  installRoot: '/opt/container',
  status: 'running',
}

const VERSION = [
  { appName: 'container', buildType: 'release', commit: 'unspecified', version: '1.0.0' },
  { appName: 'container-apiserver', buildType: 'release', commit: 'unspecified', version: 'container-apiserver version 1.0.0' },
]

function route(spec, handle) {
  const args = spec.argv.slice(1)
  if (args[0] === 'system' && args[1] === 'status') {
    handle.stdout.text = JSON.stringify(STATUS)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'system' && args[1] === 'version') {
    handle.stdout.text = JSON.stringify(VERSION)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'system' && args[1] === 'df') {
    handle.stdout.text = JSON.stringify(DF)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'system' && args[1] === 'start') return { exitCode: 0, signal: null }
  if (args[0] === 'system' && args[1] === 'stop') return { exitCode: 0, signal: null }
  if (args[0] === 'list') {
    handle.stdout.text = JSON.stringify(CONTAINERS)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'image' && args[1] === 'list') {
    handle.stdout.text = JSON.stringify(IMAGES)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'volume' && args[1] === 'list') {
    handle.stdout.text = JSON.stringify(VOLUMES)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'network' && args[1] === 'list') {
    handle.stdout.text = JSON.stringify(NETWORKS)
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'inspect' || (args[0] === 'image' && args[1] === 'inspect') || (args[0] === 'volume' && args[1] === 'inspect') || (args[0] === 'network' && args[1] === 'inspect')) {
    handle.stdout.text = JSON.stringify([{ id: args.at(-1), configuration: { name: args.at(-1) } }])
    return { exitCode: 0, signal: null }
  }
  if (args[0] === 'logs') {
    handle.stdout.text = 'log line\n'
    return { exitCode: 0, signal: null }
  }
  handle.stdout.text = 'done\n'
  return { exitCode: 0, signal: null }
}

function makeProvider() {
  const subprocess = new FakeSubprocess(route)
  const provider = new AppleProvider({
    subprocess,
    platform: 'darwin',
    home: '/tmp',
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
    config: { containerPath: executablePath, enableRuntimeControl: true },
  })
  return { provider, subprocess }
}

const owner = { principal: { kind: 'owner' } }

test('apple status maps system service, versions, and disk counts', async () => {
  const { provider } = makeProvider()
  const value = await provider.status({}, undefined)
  assert.equal(value.provider, 'apple-container')
  assert.equal(value.daemon.state, 'running')
  assert.equal(value.runtime.kind, 'apple-container')
  assert.equal(value.runtime.canStart, false)
  assert.equal(value.runtime.canStop, true)
  assert.equal(value.runtime.canRestart, false)
  assert.equal(value.client.version, '1.0.0')
  assert.equal(value.server.containers, 1)
  assert.equal(value.server.containersRunning, 1)
  assert.equal(value.server.images, 2)
  assert.equal(value.context.selected, null)
  assert.equal(value.capabilities.compose, false)
})

test('apple lists and normalizes all resources', async () => {
  const { provider } = makeProvider()
  const containers = await provider.list({ resource: 'containers', all: true }, undefined)
  assert.equal(containers.items[0].name, 'web')
  assert.equal(containers.items[0].image, 'docker.io/library/nginx:latest')
  assert.equal(containers.items[0].state, 'running')
  assert.deepEqual(containers.items[0].ports, ['0.0.0.0:8080->80/tcp'])

  const images = await provider.list({ resource: 'images' }, undefined)
  assert.equal(images.items[0].repository, 'docker.io/library/alpine')
  assert.equal(images.items[0].tag, 'latest')
  assert.equal(images.items[0].architecture, 'linux/arm64/v8')

  const volumes = await provider.list({ resource: 'volumes' }, undefined)
  assert.equal(volumes.items[0].name, 'data')
  assert.equal(volumes.items[0].driver, 'local')

  const networks = await provider.list({ resource: 'networks' }, undefined)
  assert.equal(networks.items[0].name, 'default')
  assert.equal(networks.items[0].ipv4, '192.168.64.0/24')

  const disk = await provider.list({ resource: 'disk' }, undefined)
  assert.equal(disk.items.find((item) => item.type === 'Images').totalCount, 2)
  assert.equal(disk.items.find((item) => item.type === 'Containers').activeCount, 1)

  await assert.rejects(() => provider.list({ resource: 'compose' }, undefined), (error) => error.code === 'container/unsupported')
})

test('apple run is context-free, confirmation-aware, and prefix-routed', async () => {
  const { provider, subprocess } = makeProvider()
  await assert.rejects(
    () => provider.run({ command: 'container delete web' }, undefined),
    (error) => error.code === 'docker/confirmation-required',
  )
  const { run } = await provider.run({ command: 'container delete web', confirm: true }, undefined)
  assert.match(run.id, /^apple_/u)
  assert.equal(run.displayCommand, 'container delete web')
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, 'delete', 'web'])
  await new Promise((resolve) => setImmediate(resolve))
  const polled = provider.poll({ runId: run.id, stdoutOffset: 0, stderrOffset: 0 })
  assert.equal(polled.run.status, 'exited')
  assert.match(polled.stdout.text, /done/u)
})

test('apple actions map to delete and logs syntax', async () => {
  const { provider, subprocess } = makeProvider()
  await provider.action({ kind: 'container', action: 'logs', id: 'web', follow: true }, undefined)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, 'logs', '-f', '-n', '100', 'web'])
  await provider.action({ kind: 'container', action: 'delete', id: 'web', confirm: true }, undefined)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, 'delete', 'web'])
  await assert.rejects(
    () => provider.action({ kind: 'container', action: 'restart', id: 'web' }, undefined),
    (error) => error.code === 'container/unsupported',
  )
})

test('apple system lifecycle is a job with explicit start flags', async () => {
  const { provider, subprocess } = makeProvider()
  const value = await provider.runtimeAction({ action: 'start' }, undefined)
  assert.match(value.run.id, /^apple_/u)
  assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, 'system', 'start', '--disable-kernel-install', '--timeout', '120'])
  await assert.rejects(
    () => provider.runtimeAction({ action: 'stop' }, undefined),
    (error) => error.code === 'docker/confirmation-required',
  )
})

test('service routes apple status, actions, and poll by run prefix', async () => {
  const subprocess = new FakeSubprocess(route)
  const service = new DockerService({
    subprocess,
    platform: 'darwin',
    home: '/tmp',
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
    config: { dockerPath: executablePath, containerPath: executablePath, enableRuntimeControl: true },
  })
  const providers = await service.handle('providers', {}, undefined, owner)
  assert.equal(providers.ok, true)
  assert.equal(providers.value.providers.some((provider) => provider.id === 'apple-container'), true)

  const status = await service.handle('status', { provider: 'apple-container' }, undefined, owner)
  assert.equal(status.ok, true)
  assert.equal(status.value.provider, 'apple-container')

  const action = await service.handle('action', { provider: 'apple-container', kind: 'container', action: 'start', id: 'web' }, undefined, owner)
  assert.equal(action.ok, true)
  assert.match(action.value.run.id, /^apple_/u)
  await new Promise((resolve) => setImmediate(resolve))
  const polled = await service.handle('poll', { runId: action.value.run.id }, undefined, owner)
  assert.equal(polled.ok, true)
  assert.equal(typeof polled.value.run.status, 'string')
})

test('apple status treats a reachable list as running when system status is unregistered', async () => {
  const subprocess = new FakeSubprocess((spec, handle) => {
    const args = spec.argv.slice(1)
    if (args[0] === 'system' && args[1] === 'status') {
      handle.stdout.text = JSON.stringify({ status: 'unregistered' })
      return { exitCode: 0, signal: null }
    }
    if (args[0] === 'system' && args[1] === 'version') {
      handle.stdout.text = JSON.stringify(VERSION)
      return { exitCode: 0, signal: null }
    }
    if (args[0] === 'list') {
      handle.stdout.text = '[]'
      return { exitCode: 0, signal: null }
    }
    if (args[0] === 'system' && args[1] === 'df') {
      handle.stdout.text = JSON.stringify(DF)
      return { exitCode: 0, signal: null }
    }
    handle.stdout.text = ''
    return { exitCode: 0, signal: null }
  })
  const provider = new AppleProvider({
    subprocess,
    platform: 'darwin',
    home: '/tmp',
    env: { HOME: '/tmp', PATH: '/usr/bin:/bin' },
    config: { containerPath: executablePath, enableRuntimeControl: true },
  })
  const value = await provider.status({}, undefined)
  assert.equal(value.daemon.state, 'running')
  assert.equal(value.runtime.running, true)
  assert.equal(value.runtime.canStart, false)
  assert.equal(value.daemon.error, null)
})

test('apple run-container action maps to container run', async () => {
  const { provider, subprocess } = makeProvider()
  await provider.action({
    kind: 'container',
    action: 'run',
    image: 'alpine:latest',
    name: 'web',
    command: 'sleep 10',
    ports: ['8080:80'],
    env: ['A=B'],
  }, undefined)
  assert.deepEqual(subprocess.specs.at(-1).argv, [
    executablePath, 'run', '-d', '--name', 'web', '-p', '8080:80', '-e', 'A=B',
    'alpine:latest', 'sleep', '10',
  ])
})
