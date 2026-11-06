import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CommandError,
  detectDestructive,
  isSensitiveCommand,
  normalizeContext,
  normalizeSubcommand,
  parseCommand,
  resolveCwd,
} from '../src/host/commands.js'

test('parseCommand strips a docker prefix and keeps quoted arguments', () => {
  assert.deepEqual(parseCommand('docker ps -a'), ['ps', '-a'])
  assert.deepEqual(parseCommand('ps -a'), ['ps', '-a'])
  assert.deepEqual(parseCommand("run --name 'hello world' alpine echo \"hi there\""), [
    'run',
    '--name',
    'hello world',
    'alpine',
    'echo',
    'hi there',
  ])
  assert.deepEqual(parseCommand('run -e A=1 image echo a\\ b'), ['run', '-e', 'A=1', 'image', 'echo', 'a b'])
})

test('parseCommand rejects shell syntax and malformed quotes', () => {
  for (const input of ['docker ps | grep x', 'ps; rm -rf /', 'ps > out', 'echo $(whoami)', 'ps `id`', 'ps "unterminated']) {
    assert.throws(() => parseCommand(input), CommandError, input)
  }
  assert.throws(() => parseCommand(''), CommandError)
  assert.throws(() => parseCommand('   '), CommandError)
})

test('normalizeSubcommand rejects context/host overrides', () => {
  assert.deepEqual(normalizeSubcommand(['ps'], { dockerPath: '/opt/homebrew/bin/docker' }), ['ps'])
  assert.deepEqual(normalizeSubcommand(['docker', 'ps'], { dockerPath: '/opt/homebrew/bin/docker' }), ['ps'])
  for (const argv of [['--context', 'other', 'ps'], ['--context=other', 'ps'], ['-H', 'tcp://x', 'ps'], ['--host=x', 'ps']]) {
    assert.throws(() => normalizeSubcommand(argv, { dockerPath: '/opt/homebrew/bin/docker' }), CommandError)
  }
})

test('detectDestructive covers common delete/stop/prune forms', () => {
  assert.deepEqual(detectDestructive(['ps']), { dangerous: false, reason: null })
  assert.equal(detectDestructive(['rm', '-f', 'x']).reason, 'delete')
  assert.equal(detectDestructive(['rmi', 'x']).reason, 'delete')
  assert.equal(detectDestructive(['stop', 'x']).reason, 'stop')
  assert.equal(detectDestructive(['kill', 'x']).reason, 'stop')
  assert.equal(detectDestructive(['system', 'prune', '-a']).reason, 'prune')
  assert.equal(detectDestructive(['volume', 'rm', 'x']).reason, 'delete')
  assert.equal(detectDestructive(['compose', 'down']).reason, 'compose-down')
})

test('normalizeContext validates names and membership', () => {
  assert.equal(normalizeContext(undefined), null)
  assert.equal(normalizeContext('colima', { known: new Set(['colima']) }), 'colima')
  assert.throws(() => normalizeContext('bad context'), CommandError)
  assert.throws(() => normalizeContext('missing', { known: new Set(['colima']) }), /未知的 Docker context/)
})

test('resolveCwd accepts absolute directories and rejects invalid paths', () => {
  const statSync = (path) => ({
    isDirectory: () => path === '/tmp',
  })
  assert.equal(resolveCwd('/tmp', { fallback: '/home/test', statSync }), '/tmp')
  assert.equal(resolveCwd(undefined, { fallback: '/home/test', statSync }), '/home/test')
  assert.throws(() => resolveCwd('relative', { fallback: '/home/test', statSync }), /绝对路径/)
  assert.throws(() => resolveCwd('/missing', { fallback: '/home/test', statSync }), /不是目录/)
})

test('sensitive command detection keeps credentials out of history', () => {
  assert.equal(isSensitiveCommand(['login', 'registry.example']), true)
  assert.equal(isSensitiveCommand(['login', '--password-stdin']), true)
  assert.equal(isSensitiveCommand(['ps', '-a']), false)
})
