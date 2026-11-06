import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyEndpoint,
  mapDockerInfo,
  mapDockerVersion,
  normalizeContainer,
  normalizeImage,
  normalizeNetwork,
  normalizeVolume,
  parseColimaList,
  parseColimaStatus,
  parseComposeList,
  parseContexts,
  parseNdjson,
  parseSystemDf,
} from '../src/host/parsers.js'

test('parseNdjson handles lines, blank lines, and arrays', () => {
  const items = parseNdjson('{"a":1}\n\n{"a":2}\n')
  assert.deepEqual(items, [{ a: 1 }, { a: 2 }])
  assert.deepEqual(parseNdjson('[{"a":1},{"a":2}]\n'), [{ a: 1 }, { a: 2 }])
  assert.deepEqual(parseNdjson(''), [])
})

test('parseContexts reads current and endpoint fields', () => {
  const { contexts } = parseContexts(
    '{"Current":true,"Description":"colima","DockerEndpoint":"unix:///Users/me/.colima/default/docker.sock","Error":"","Name":"colima"}\n' +
      '{"Current":false,"Description":"default","DockerEndpoint":"unix:///var/run/docker.sock","Error":"","Name":"default"}\n',
  )
  assert.equal(contexts.length, 2)
  assert.deepEqual(contexts[0], {
    name: 'colima',
    description: 'colima',
    endpoint: 'unix:///Users/me/.colima/default/docker.sock',
    current: true,
    error: '',
  })
})

test('classifyEndpoint distinguishes colima, orbstack, local socket, and remote', () => {
  assert.deepEqual(classifyEndpoint('unix:///Users/me/.colima/default/docker.sock'), { kind: 'colima', profile: 'default' })
  assert.deepEqual(classifyEndpoint('unix:///Users/me/.orbstack/run/docker.sock'), { kind: 'orbstack' })
  assert.deepEqual(classifyEndpoint('unix:///var/run/docker.sock'), { kind: 'local-socket' })
  assert.deepEqual(classifyEndpoint('ssh://user@host'), { kind: 'remote' })
  assert.deepEqual(classifyEndpoint('tcp://host:2375'), { kind: 'remote' })
})

test('normalizeContainer derives names, ports, and labels', () => {
  const item = normalizeContainer({
    ID: 'abc',
    Names: 'web,web-alias',
    Image: 'nginx:latest',
    Command: '"nginx"',
    CreatedAt: '2026-01-01',
    RunningFor: '2 hours',
    Ports: '0.0.0.0:8080->80/tcp, :::8080->80/tcp',
    Status: 'Up 2 hours',
    State: 'running',
    Size: '0B',
    Labels: 'com.example=a,com.example.two=b',
  })
  assert.equal(item.name, 'web')
  assert.deepEqual(item.names, ['web', 'web-alias'])
  assert.deepEqual(item.ports, ['0.0.0.0:8080->80/tcp', ':::8080->80/tcp'])
  assert.equal(item.labels['com.example'], 'a')
})

test('normalizeImage and network/volume shapes are stable', () => {
  assert.equal(normalizeImage({ Repository: 'alpine', Tag: '3.20', ID: 'sha256:1', Size: '7MB' }).name, 'alpine:3.20')
  assert.equal(normalizeImage({ Repository: '<none>', Tag: '<none>', ID: '<none>' }).name, '<none>')
  assert.equal(normalizeVolume({ Name: 'v', Driver: 'local', Mountpoint: '/var/lib/docker/volumes/v' }).mountpoint, '/var/lib/docker/volumes/v')
  assert.equal(normalizeNetwork({ ID: 'n', Name: 'bridge', Driver: 'bridge', Scope: 'local' }).driver, 'bridge')
})

test('parseComposeList handles JSON and the old table fallback', () => {
  const json = parseComposeList('[{"Name":"app","Status":"running(1)","ConfigFiles":"/tmp/compose.yml"}]')
  assert.equal(json.format, 'json')
  assert.equal(json.items[0].name, 'app')
  assert.equal(json.items[0].configFiles, '/tmp/compose.yml')
  const text = parseComposeList('NAME    STATUS    CONFIG FILES\napp     running(1)  /tmp/compose.yml\n')
  assert.equal(text.format, 'text')
  assert.equal(text.items[0].name, 'app')
})

test('mapDockerVersion/mapDockerInfo read the fields the UI needs', () => {
  const version = mapDockerVersion({
    Client: { Version: '28.2.2', ApiVersion: '1.50', Context: 'colima', Os: 'darwin', Arch: 'arm64' },
    Server: { Version: '27.4.0', ApiVersion: '1.47', Os: 'linux', Arch: 'arm64' },
  })
  assert.equal(version.client.version, '28.2.2')
  assert.equal(version.server.version, '27.4.0')
  const info = mapDockerInfo({
    Name: 'colima',
    ServerVersion: '27.4.0',
    OSType: 'linux',
    OperatingSystem: 'Ubuntu',
    Architecture: 'aarch64',
    NCPU: 4,
    MemTotal: 8589934592,
    Containers: 0,
    ContainersRunning: 0,
    ContainersStopped: 0,
    Images: 0,
    ClientInfo: { Version: '28.2.2', Context: 'colima' },
  })
  assert.equal(info.server.ncpu, 4)
  assert.equal(info.server.memTotal, 8589934592)
  assert.equal(info.client.version, '28.2.2')
})

test('colima parsers and system df are tolerant', () => {
  assert.deepEqual(parseColimaList('{"name":"default","status":"Running","cpus":4,"memory":8589934592,"disk":107374182400}\n'), [
    { name: 'default', status: 'Running', arch: '', cpus: 4, memory: 8589934592, disk: 107374182400, runtime: '', raw: { name: 'default', status: 'Running', cpus: 4, memory: 8589934592, disk: 107374182400 } },
  ])
  const status = parseColimaStatus('{"display_name":"colima","driver":"macOS Virtualization.Framework","cpu":4,"memory":8,"docker_socket":"unix:///x"}')
  assert.equal(status.driver, 'macOS Virtualization.Framework')
  assert.equal(status.dockerSocket, 'unix:///x')
  const df = parseSystemDf('{"Type":"Images","TotalCount":1,"ActiveCount":0,"Size":"1GB","Reclaimable":"1GB"}\n')
  assert.equal(df[0].type, 'Images')
})
