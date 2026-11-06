import assert from 'node:assert/strict'
import { test } from 'node:test'

import { JobManager } from '../src/host/jobs.js'

import { FakeSubprocess } from './fake.js'

function makeJobManager(respond, options = {}) {
  const cli = {
    childEnv: () => ({ PATH: '/usr/bin:/bin' }),
  }
  return new JobManager({
    subprocess: new FakeSubprocess(respond),
    cli,
    minTimeoutMs: 10,
    maxRuns: options.maxRuns ?? 4,
    retentionMs: options.retentionMs ?? 60_000,
    maxRecords: options.maxRecords ?? 30,
  })
}

test('start/poll reads incremental output and settles on exit', async () => {
  const jobs = makeJobManager((_spec, handle) => {
    handle.stdout.text = 'hello\n'
    handle.stderr.text = 'warn\n'
    return { exitCode: 0, signal: null }
  })
  const run = jobs.start({
    argv: ['/fake/docker', 'ps'],
    displayCommand: 'docker ps',
    context: 'colima',
    cwd: '/tmp',
    title: 'ps',
  })
  assert.equal(run.status, 'running')
  const first = jobs.poll({ runId: run.id, stdoutOffset: 0, stderrOffset: 0 })
  assert.equal(first.stdout.text, 'hello\n')
  assert.equal(first.stderr.text, 'warn\n')
  assert.equal(first.stdout.nextOffset, 6)
  await Promise.resolve()
  await Promise.resolve()
  const second = jobs.poll({ runId: run.id, stdoutOffset: first.stdout.nextOffset, stderrOffset: first.stderr.nextOffset })
  assert.equal(second.stdout.text, '')
  assert.equal(second.run.status, 'exited')
  assert.equal(second.run.exitCode, 0)
  jobs.dispose()
})

test('cancel terminates the handle and marks the run cancelled', async () => {
  const jobs = makeJobManager(() => undefined)
  const run = jobs.start({ argv: ['/fake/docker', 'events'], displayCommand: 'docker events', cwd: '/tmp' })
  const cancelling = jobs.cancel(run.id)
  assert.equal(cancelling.status, 'cancelling')
  await Promise.resolve()
  await Promise.resolve()
  const polled = jobs.poll({ runId: run.id })
  assert.equal(polled.run.status, 'cancelled')
  assert.equal(jobs.find(run.id).handle.terminated, true)
  jobs.dispose()
})

test('timeout terminates the handle and settles as timed-out', async () => {
  const jobs = makeJobManager(() => undefined)
  const run = jobs.start({ argv: ['/fake/docker', 'events'], displayCommand: 'docker events', cwd: '/tmp', timeoutMs: 10 })
  await new Promise((resolve) => setTimeout(resolve, 30))
  const polled = jobs.poll({ runId: run.id })
  assert.equal(polled.run.status, 'timed-out')
  assert.equal(polled.run.timedOut, true)
  jobs.dispose()
})

test('run limit, unknown runs, and failure outcomes are explicit', async () => {
  const limited = makeJobManager(() => undefined, { maxRuns: 1 })
  limited.start({ argv: ['/fake/docker', 'events'], displayCommand: 'docker events', cwd: '/tmp' })
  assert.throws(
    () => limited.start({ argv: ['/fake/docker', 'events'], displayCommand: 'docker events', cwd: '/tmp' }),
    /上限/,
  )
  limited.dispose()

  const failed = makeJobManager(() => ({ exitCode: 1, signal: null }))
  const run = failed.start({ argv: ['/fake/docker', 'ps'], displayCommand: 'docker ps', cwd: '/tmp' })
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(failed.poll({ runId: run.id }).run.status, 'failed')
  assert.throws(() => failed.poll({ runId: 'missing' }), /不存在/)
  failed.dispose()
})

test('lossy reads and retention pruning are observable', async () => {
  const jobs = makeJobManager((_spec, handle) => {
    handle.stdout.text = '0123456789'
    handle.stdout.lossy = true
    return { exitCode: 0, signal: null }
  }, { retentionMs: 60_000, maxRecords: 1 })
  const run = jobs.start({ argv: ['/fake/docker', 'ps'], displayCommand: 'docker ps', cwd: '/tmp' })
  await new Promise((resolve) => setTimeout(resolve, 20))
  const polled = jobs.poll({ runId: run.id, stdoutOffset: 5 })
  assert.equal(polled.stdout.text, '56789')
  assert.equal(polled.stdout.lossy, true)
  jobs.retentionMs = 0
  jobs.sweep()
  assert.equal(jobs.records.has(run.id), false)
  jobs.dispose()
})
