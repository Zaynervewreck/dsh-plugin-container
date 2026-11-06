/**
 * Interactive PTY sessions for `docker attach` and Apple `container exec`.
 *
 * The DSH subprocess service exposes spawnTerminal, whose handle owns a PTY,
 * raw output stream, write(), resize(), and terminate(). This manager keeps the
 * PTY process out of the one-shot JobManager: attach sessions are long-lived,
 * browser-driven, and have their own bounded output buffer.
 */
import { randomUUID } from 'node:crypto'

import { codeOf, messageOf } from './util.js'

const MAX_SESSIONS = 2
const MAX_INPUT_BYTES = 8192
const MAX_COLS = 300
const MIN_COLS = 20
const MAX_ROWS = 120
const MIN_ROWS = 5

/** @param {unknown} value @param {number} min @param {number} max @param {number} fallback */
function dimension(value, min, max, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(Math.max(Math.trunc(number), min), max)
}

/** @param {unknown} value @param {string} message @param {string} code */
function attachError(message, code) {
  return Object.assign(new Error(message), { code })
}

export class AttachManager {
  /**
   * @param {{
   *   subprocess: any,
   *   maxBytes?: number,
   *   maxSessions?: number,
   * }} options
   */
  constructor(options) {
    this.subprocess = options.subprocess
    this.maxBytes = Math.min(Math.max(Number(options.maxBytes ?? 1_500_000), 64 * 1024), 8 * 1024 * 1024)
    this.maxSessions = Math.min(Math.max(Number(options.maxSessions ?? MAX_SESSIONS), 1), 8)
    this.sessions = new Map()
  }

  /**
   * @param {{
   *   argv: string[],
   *   cwd: string,
   *   env?: NodeJS.ProcessEnv,
   *   provider: string,
   *   containerId: string,
   *   containerName?: string,
   *   command: string,
   *   mode?: 'attach' | 'exec',
   *   cols?: number,
   *   rows?: number,
   *   signal?: AbortSignal,
   * }} input
   */
  async start(input) {
    if (typeof this.subprocess.spawnTerminal !== 'function') {
      throw attachError('当前 DSH 版本不支持 PTY 终端，无法 attach', 'docker/attach-unsupported')
    }
    if (this.sessions.size >= this.maxSessions) {
      throw attachError(`最多同时打开 ${String(this.maxSessions)} 个 attach 终端，请先关闭一个`, 'docker/attach-limit')
    }
    const cols = dimension(input.cols, MIN_COLS, MAX_COLS, 120)
    const rows = dimension(input.rows, MIN_ROWS, MAX_ROWS, 30)
    let handle
    try {
      handle = await this.subprocess.spawnTerminal({
        argv: input.argv,
        cwd: input.cwd,
        cols,
        rows,
        terminalType: 'xterm-256color',
        env: input.env ?? {},
        graceMs: 2000,
        signal: input.signal,
      })
    } catch (error) {
      throw attachError(`无法启动 attach 终端: ${messageOf(error)}`, 'docker/attach-failed')
    }
    if (handle === null || typeof handle !== 'object' || handle.output === undefined || typeof handle.write !== 'function') {
      try { await handle?.terminate?.() } catch { /* best effort */ }
      throw attachError('attach 终端句柄不可用', 'docker/attach-failed')
    }

    const id = `attach_${randomUUID()}`
    /** @type {any} */
    const session = {
      id,
      provider: input.provider,
      containerId: input.containerId,
      containerName: input.containerName ?? input.containerId,
      command: input.command,
      mode: input.mode === 'exec' ? 'exec' : 'attach',
      cols,
      rows,
      status: 'running',
      exitCode: null,
      startedAt: Date.now(),
      endedAt: null,
      error: null,
      output: '',
      /** Absolute offset of output[0] within the session's full output. */
      baseOffset: 0,
      handle,
      closed: false,
    }
    this.sessions.set(id, session)
    handle.output.on('data', (chunk) => this.append(session, String(chunk)))
    handle.done.then(
      (outcome) => {
        if (session.closed) return
        session.status = 'exited'
        session.exitCode = outcome?.exitCode ?? null
        session.endedAt = Date.now()
      },
      (error) => {
        if (session.closed) return
        session.status = 'failed'
        session.endedAt = Date.now()
        session.error = messageOf(error)
      },
    )
    return this.info(session)
  }

  /** @param {any} session @param {string} text */
  append(session, text) {
    if (text === '') return
    session.output += text
    if (session.output.length > this.maxBytes) {
      const remove = session.output.length - this.maxBytes
      session.output = session.output.slice(remove)
      session.baseOffset += remove
    }
  }

  /** @param {any} session */
  info(session) {
    return {
      id: session.id,
      provider: session.provider,
      containerId: session.containerId,
      containerName: session.containerName,
      command: session.command,
      mode: session.mode,
      cols: session.cols,
      rows: session.rows,
      status: session.status,
      exitCode: session.exitCode,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      error: session.error,
    }
  }

  /** @param {string} id */
  require(id) {
    if (typeof id !== 'string' || id === '') throw attachError('缺少 attachId', 'docker/attach-unknown')
    const session = this.sessions.get(id)
    if (session === undefined) throw attachError('attach 会话不存在或已关闭', 'docker/attach-unknown')
    return session
  }

  /** @param {Record<string, any>} input */
  poll(input) {
    const session = this.require(input.attachId)
    const requested = Number(input.offset)
    const offset = Number.isFinite(requested) && requested >= 0 ? Math.trunc(requested) : 0
    const lossy = offset < session.baseOffset
    const start = Math.max(offset, session.baseOffset) - session.baseOffset
    return {
      session: this.info(session),
      output: {
        text: session.output.slice(start),
        nextOffset: session.baseOffset + session.output.length,
        lossy,
      },
    }
  }

  /** @param {Record<string, any>} input */
  async write(input) {
    const session = this.require(input.attachId)
    if (session.status !== 'running') throw attachError('attach 终端已结束', 'docker/attach-closed')
    const data = input.data
    if (typeof data !== 'string' || data === '') throw attachError('缺少输入内容', 'docker/attach-input')
    if (Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) throw attachError('单次输入过长', 'docker/attach-input')
    try {
      await session.handle.write(data)
    } catch (error) {
      throw attachError(`写入 attach 终端失败: ${messageOf(error)}`, 'docker/attach-input')
    }
    return this.info(session)
  }

  /** @param {Record<string, any>} input */
  async resize(input) {
    const session = this.require(input.attachId)
    if (session.status !== 'running') return this.info(session)
    const cols = dimension(input.cols, MIN_COLS, MAX_COLS, session.cols)
    const rows = dimension(input.rows, MIN_ROWS, MAX_ROWS, session.rows)
    try {
      await session.handle.resize(cols, rows)
      session.cols = cols
      session.rows = rows
    } catch (error) {
      throw attachError(`调整 attach 终端大小失败: ${messageOf(error)}`, 'docker/attach-resize')
    }
    return this.info(session)
  }

  /** @param {Record<string, any>} input */
  async close(input) {
    const session = this.require(input.attachId)
    session.closed = true
    session.status = 'closed'
    session.endedAt = Date.now()
    try {
      await session.handle.terminate()
    } catch (error) {
      if (codeOf(error) !== 'ESRCH') session.error = messageOf(error)
    } finally {
      this.sessions.delete(session.id)
    }
    return this.info(session)
  }

  async dispose() {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    await Promise.allSettled(sessions.map(async (session) => {
      session.closed = true
      await session.handle.terminate()
    }))
  }
}

export function createAttachManager(options) {
  return new AttachManager(options)
}
