import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildArgv, buildSpec, inspectBuildContext, pushSpec } from '../src/host/images.js'
import { DockerService } from '../src/host/service.js'

import { FakeSubprocess, executablePath } from './fake.js'

const CONTEXTS = '{"Current":true,"Description":"colima","DockerEndpoint":"unix:///x.sock","Error":"","Name":"colima"}\n'
const owner = { principal: { kind: 'owner' } }

function makeService() {
  const subprocess = new FakeSubprocess((spec, handle) => {
    if (spec.argv.includes('context')) handle.stdout.text = CONTEXTS
    return { exitCode: 0, signal: null }
  })
  const service = new DockerService({
    subprocess,
    platform: 'darwin',
    home: tmpdir(),
    env: { HOME: tmpdir(), PATH: '/usr/bin:/bin' },
    config: { dockerPath: executablePath },
  })
  return { service, subprocess }
}

function project(files = ['Dockerfile']) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-build-'))
  for (const file of files) writeFileSync(join(dir, file), 'FROM scratch\n')
  return dir
}

test('inspectBuildContext lists Dockerfiles and suggests a tag', () => {
  const dir = project(['Dockerfile', 'Dockerfile.dev', 'prod.Dockerfile', 'notes.txt'])
  try {
    const info = inspectBuildContext(dir)
    assert.equal(info.exists, true)
    assert.equal(info.isDirectory, true)
    assert.deepEqual(info.dockerfiles, ['Dockerfile', 'Dockerfile.dev', 'prod.Dockerfile'])
    assert.match(info.suggestedTag, /^dsh-build-[a-z0-9]+:latest$/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  assert.equal(inspectBuildContext('relative/path').exists, false)
  assert.equal(inspectBuildContext(join(dir, 'missing')).exists, false)
})

test('buildSpec validates input and buildArgv has no shell syntax', () => {
  const dir = project(['Dockerfile', 'Dockerfile.dev'])
  try {
    const spec = buildSpec({ tag: 'me/app:1.0', contextDir: dir, file: 'Dockerfile.dev', platform: 'linux/arm64', noCache: true, buildArgs: ['A=1'] })
    assert.deepEqual(buildArgv(spec), [
      'build', '-t', 'me/app:1.0', '-f', join(dir, 'Dockerfile.dev'), '--platform', 'linux/arm64', '--no-cache', '--build-arg', 'A=1', dir,
    ])
    assert.throws(() => buildSpec({ tag: 'App:1', contextDir: dir }), /小写/u)
    assert.throws(() => buildSpec({ tag: 'app', contextDir: dir, file: '../etc/passwd' }), /构建目录内/u)
    assert.throws(() => buildSpec({ tag: 'app', contextDir: dir, platform: 'arm64' }), /平台/u)
    assert.throws(() => buildSpec({ tag: 'app', contextDir: dir, buildArgs: ['bad arg'] }), /构建参数/u)
    assert.throws(() => buildSpec({ tag: 'app', contextDir: 'relative' }), /绝对路径/u)
    assert.throws(() => buildSpec({ tag: 'app', contextDir: join(dir, 'nope') }), /不存在/u)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  const empty = project([])
  try {
    assert.throws(() => buildSpec({ tag: 'app', contextDir: empty }), /没有 Dockerfile/u)
    mkdirSync(join(empty, 'sub'))
    assert.throws(() => buildSpec({ tag: 'app', contextDir: empty, file: 'sub' }), /找不到/u)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})

test('pushSpec defaults the target to the source and rejects bad names', () => {
  assert.deepEqual(pushSpec({ id: 'me/app:1' }), { source: 'me/app:1', target: 'me/app:1' })
  assert.deepEqual(pushSpec({ id: 'app:1', target: ' ghcr.io/me/app:1 ' }), { source: 'app:1', target: 'ghcr.io/me/app:1' })
  assert.throws(() => pushSpec({ id: 'app:1', target: 'Me/App:1' }), /小写/u)
  assert.throws(() => pushSpec({ id: 'app:1', target: 'a b' }), /不合法/u)
})

test('docker build and push actions map to argv', async () => {
  const { service, subprocess } = makeService()
  const dir = project()
  try {
    const built = await service.handle('action', { kind: 'image', action: 'build', tag: 'demo:1', contextDir: dir, context: 'colima' }, undefined, owner)
    assert.equal(built.ok, true, built.error?.message)
    const spec = subprocess.specs.at(-1)
    assert.deepEqual(spec.argv, [executablePath, '--context', 'colima', 'build', '-t', 'demo:1', dir])
    assert.equal(spec.cwd, dir)

    const plain = await service.handle('action', { kind: 'image', action: 'push', id: 'me/demo:1', context: 'colima' }, undefined, owner)
    assert.equal(plain.ok, true, plain.error?.message)
    assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'push', 'me/demo:1'])

    const retagged = await service.handle('action', { kind: 'image', action: 'push', id: 'demo:1', target: 'me/demo:1', context: 'colima' }, undefined, owner)
    assert.equal(retagged.ok, true, retagged.error?.message)
    const argvs = subprocess.specs.map((entry) => entry.argv.slice(1).join(' '))
    assert.equal(argvs.at(-2), '--context colima tag demo:1 me/demo:1')
    assert.equal(argvs.at(-1), '--context colima push me/demo:1')

    const bad = await service.handle('action', { kind: 'image', action: 'build', tag: 'demo:1', contextDir: join(dir, 'nope') }, undefined, owner)
    assert.equal(bad.ok, false)
    const info = await service.handle('buildContext', { path: dir }, undefined, owner)
    assert.equal(info.ok, true)
    assert.deepEqual(info.value.dockerfiles, ['Dockerfile'])
    const providers = await service.handle('providers', {}, undefined, owner)
    assert.equal(providers.value.features.includes('image-push'), true)
    assert.equal(providers.value.features.includes('image-build'), true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
    service.dispose()
  }
})

test('pull accepts an optional platform on Docker', async () => {
  const { service, subprocess } = makeService()
  try {
    const pulled = await service.handle('action', { kind: 'image', action: 'pull', id: 'alpine:latest', platform: 'linux/amd64', context: 'colima' }, undefined, owner)
    assert.equal(pulled.ok, true, pulled.error?.message)
    assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'pull', '--platform', 'linux/amd64', 'alpine:latest'])
    const bad = await service.handle('action', { kind: 'image', action: 'pull', id: 'alpine:latest', platform: 'amd64', context: 'colima' }, undefined, owner)
    assert.equal(bad.ok, false)
    const plain = await service.handle('action', { kind: 'image', action: 'pull', id: 'alpine:latest', context: 'colima' }, undefined, owner)
    assert.deepEqual(subprocess.specs.at(-1).argv, [executablePath, '--context', 'colima', 'pull', 'alpine:latest'])
    assert.equal(plain.ok, true)
  } finally {
    service.dispose()
  }
})
