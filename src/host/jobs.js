/**
 * Long-running Docker/CLI jobs with offset polling, cancellation, timeouts,
 * bounded retention, and a concurrency cap.
 *
 * Jobs are independent of a single RPC call: `run` returns immediately and
 * `poll` reads non-consuming collectors. That makes the terminal resilient to
 * tab switches and navigation while the host command keeps running.
 */
import { randomUUID } from 'node:crypto'

import { DockerCommandError } from './docker-cli.js'
import { codeOf, messageOf } from './util.js'

const MAX_RUNS = 4
const RETENTION_MS = 10 * 60_000
const MAX_RECORDS = 30
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 30 * 60_000
const DEFAULT_TIMEOUT_MS = 120_000

/** @param {unknown} value @param {number} fallback */
function clampOffset(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback
}

/** @param {unknown} value @param {number} min */
function clampTimeout(value, min = MIN_TIMEOUT_MS) {
  const requested = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_TIMEOUT_MS
  return Math.min(Math.max(requested, min), MAX_TIMEOUT_MS)
}

export class JobManager {
  /**
   * @param {{
   *   subprocess: any,
   *   cli: import('./docker-cli.js').DockerCli,
   *   maxOutputBytes?: number,
   *   maxRuns?: number,
   *   retentionMs?: number,
   *   maxRecords?: number,
   * }} options
   */
  constructor(options) {
    this.subprocess = options.subprocess
    this.cli = options.cli
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
    this.maxRuns = options.maxRuns ?? MAX_RUNS
    this.retentionMs = options.retentionMs ?? RETENTION_MS
    this.maxRecords = options.maxRecords ?? MAX_RECORDS
    this.minTimeoutMs = options.minTimeoutMs ?? MIN_TIMEOUT_MS
    this.idPrefix = options.idPrefix ?? 'run'
    /** @type {Map<string, any>} */
    this.records = new Map()
    this.sweeper = setInterval(() => this.sweep(), 60_000)
    this.sweeper.unref?.()
  }

  /** @param {string} runId */
  find(runId) {
    const record = this.records.get(runId)
    if (record === undefined) {
      throw Object.assign(new Error(`Docker 运行记录不存在或已过期: ${runId}`), { code: 'docker/run-not-found' })
    }
    return record
  }

  /** @param {any} record */
  publicView(record) {
    return {
      id: record.id,
      argv: record.argv,
      displayCommand: record.displayCommand,
      context: record.context,
      cwd: record.cwd,
      title: record.title,
      status: record.status,
      exitCode: record.exitCode,
      signal: record.signal,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      timedOut: record.timedOut,
      error: record.error,
    }
  }

  /**
   * @param {{
   *   argv: string[],
   *   displayCommand: string,
   *   context?: string | null,
   *   cwd: string,
   *   title?: string,
   *   timeoutMs?: number,
   *   maxOutputBytes?: number,
   * }} input
   */
  start(input) {
    const active = [...this.records.values()].filter((record) => record.status === 'running' || record.status === 'cancelling')
    if (active.length >= this.maxRuns) {
      throw Object.assign(
        new Error(`同时运行的 Docker 命令已达上限（${this.maxRuns} 个）`),
        { code: 'docker/run-limit', details: { active: active.map((record) => record.id) } },
      )
    }
    if (!Array.isArray(input.argv) || input.argv.length === 0) throw new DockerCommandError('命令为空', { code: 'docker/invalid-command' })
    const timeoutMs = clampTimeout(input.timeoutMs, this.minTimeoutMs)
    const requestedMax = Number(input.maxOutputBytes ?? this.maxOutputBytes)
    const maxBytes = Number.isFinite(requestedMax) ? Math.min(Math.max(requestedMax, 64 * 1024), 8 * 1024 * 1024) : 1024 * 1024
    const id = `${this.idPrefix}_${randomUUID()}`
    const record = {
      id,
      argv: [...input.argv],
      displayCommand: input.displayCommand,
      context: input.context ?? null,
      cwd: input.cwd,
      title: input.title ?? '',
      status: 'running',
      exitCode: null,
      signal: null,
      startedAt: Date.now(),
      endedAt: null,
      timedOut: false,
      cancelled: false,
      error: null,
      handle: undefined,
      stdout: undefined,
      stderr: undefined,
      timer: undefined,
      abort: undefined,
    }

    try {
      record.handle = this.subprocess.spawn({
        argv: record.argv,
        cwd: record.cwd,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
        graceMs: 2000,
        env: this.cli.childEnv(),
      })
    } catch (error) {
      throw new DockerCommandError(`无法启动命令: ${messageOf(error)}`, {
        code: codeOf(error) === 'ENOENT' ? 'docker/cli-missing' : 'docker/exec-failed',
      })
    }

    record.stdout = record.handle.collected?.stdout
    record.stderr = record.handle.collected?.stderr
    record.timer = setTimeout(() => {
      if (record.status !== 'running') return
      record.timedOut = true
      try {
        record.handle?.terminate?.()
      } catch {
        // done still settles the record.
      }
    }, timeoutMs)
    record.timer.unref?.()

    const finish = (outcome) => {
      if (record.status === 'exited' || record.status === 'cancelled' || record.status === 'timed-out' || record.status === 'failed') return
      clearTimeout(record.timer)
      record.endedAt = Date.now()
      record.exitCode = outcome?.exitCode ?? null
      record.signal = outcome?.signal ?? null
      if (record.timedOut) record.status = 'timed-out'
      else if (record.cancelled === true) record.status = 'cancelled'
      else if (record.exitCode === 0) record.status = 'exited'
      else record.status = 'failed'
      this.sweep()
    }

    record.handle.done.then(finish, (error) => {
      if (record.status !== 'running') return
      clearTimeout(record.timer)
      record.endedAt = Date.now()
      record.error = messageOf(error)
      record.status = 'failed'
      this.sweep()
    })

    this.records.set(id, record)
    return this.publicView(record)
  }

  /**
   * @param {{runId: string, stdoutOffset?: number, stderrOffset?: number}} input
   */
  poll(input) {
    const record = this.find(input.runId)
    const read = (reader, offset) => {
      if (reader === undefined) return { text: '', nextOffset: offset, lossy: false }
      const value = reader.readFrom(clampOffset(offset))
      return { text: value.text, nextOffset: value.nextOffset, lossy: value.lossy === true }
    }
    return {
      run: this.publicView(record),
      stdout: read(record.stdout, clampOffset(input.stdoutOffset)),
      stderr: read(record.stderr, clampOffset(input.stderrOffset)),
    }
  }

  /** @param {string} runId */
  cancel(runId) {
    const record = this.find(runId)
    if (record.status !== 'running' && record.status !== 'cancelling') return this.publicView(record)
    record.cancelled = true
    record.status = 'cancelling'
    try {
      record.handle?.terminate?.()
    } catch (error) {
      record.error = messageOf(error)
    }
    return this.publicView(record)
  }

  /** Remove terminal records beyond retention or count. */
  sweep() {
    const now = Date.now()
    const terminal = [...this.records.values()]
      .filter((record) => record.status !== 'running' && record.status !== 'cancelling')
      .sort((left, right) => (left.endedAt ?? left.startedAt) - (right.endedAt ?? right.startedAt))
    for (const record of terminal) {
      if (now - (record.endedAt ?? record.startedAt) > this.retentionMs) this.records.delete(record.id)
    }
    const remainingTerminal = [...this.records.values()]
      .filter((record) => record.status !== 'running' && record.status !== 'cancelling')
      .sort((left, right) => (right.endedAt ?? right.startedAt) - (left.endedAt ?? left.startedAt))
    for (const record of remainingTerminal.slice(this.maxRecords)) this.records.delete(record.id)
  }

  dispose() {
    clearInterval(this.sweeper)
    for (const record of this.records.values()) {
      clearTimeout(record.timer)
      if (record.status === 'running' || record.status === 'cancelling') {
        try {
          record.handle?.terminate?.()
        } catch {
          // Best effort on plugin unload.
        }
      }
    }
    this.records.clear()
  }
}
