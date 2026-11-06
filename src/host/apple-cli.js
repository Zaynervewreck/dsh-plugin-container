/**
 * Apple `container` CLI discovery and process execution.
 *
 * Apple container is not Docker: there is no daemon socket, no Docker context,
 * and every container runs in its own lightweight VM. The CLI is invoked
 * directly and its `--format json` output is parsed by the provider.
 */
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { summarizeStderr } from './parsers.js'
import { codeOf, messageOf } from './util.js'

const DEFAULT_MAX_OUTPUT = 1024 * 1024
const DEFAULT_TIMEOUT = 20_000
const RESOLVE_RETRY_MS = 10_000

export class AppleCliError extends Error {
  /** @param {string} message @param {string} code @param {Record<string, unknown>} details */
  constructor(message, code = 'container/cli-missing', details = {}) {
    super(message)
    this.name = 'AppleCliError'
    this.code = code
    this.details = details
  }
}

export class AppleCommandError extends Error {
  /** @param {string} message @param {{code?: string, stderr?: string, details?: Record<string, unknown>}} [options] */
  constructor(message, options = {}) {
    super(message)
    this.name = 'AppleCommandError'
    this.code = options.code ?? 'container/exec-failed'
    this.stderr = options.stderr ?? ''
    this.details = options.details ?? {}
  }
}

/** @param {string} path */
function executable(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** @param {number} value @param {number} fallback */
function clampBytes(value, fallback) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 64 * 1024), 8 * 1024 * 1024) : fallback
}

export class AppleCli {
  /**
   * @param {{
   *   subprocess: any,
   *   config?: Record<string, any>,
   *   env?: NodeJS.ProcessEnv,
   *   home?: string,
   *   platform?: NodeJS.Platform,
   *   logger?: any,
   * }} options
   */
  constructor(options) {
    this.subprocess = options.subprocess
    this.config = options.config ?? {}
    this.env = options.env ?? process.env
    this.home = options.home ?? homedir()
    this.platform = options.platform ?? process.platform
    this.logger = options.logger
    this.maxOutput = clampBytes(Number(this.config.maxOutputBytes), DEFAULT_MAX_OUTPUT)
    this.containerPath = undefined
    this.lastAttempt = 0
    this.error = undefined
  }

  /** @returns {string[]} */
  candidates() {
    const configured = typeof this.config.containerPath === 'string' && this.config.containerPath.trim() !== '' ? this.config.containerPath.trim() : null
    const envPath = typeof this.env.CONTAINER_PATH === 'string' && this.env.CONTAINER_PATH.trim() !== '' ? this.env.CONTAINER_PATH.trim() : null
    return [
      configured,
      envPath,
      '/usr/local/bin/container',
      '/opt/homebrew/bin/container',
      join(this.home, '.local/bin/container'),
    ].filter((value, index, list) => typeof value === 'string' && value !== '' && list.indexOf(value) === index)
  }

  /** @param {AbortSignal | undefined} signal */
  async resolveOnPath(signal) {
    if (typeof this.subprocess.resolveExecutable !== 'function') return undefined
    try {
      return await this.subprocess.resolveExecutable('container', undefined, signal)
    } catch (error) {
      if (error?.name === 'SubprocessExecutableNotFoundError' || codeOf(error) === 'ENOENT') return undefined
      throw error
    }
  }

  /**
   * @param {{signal?: AbortSignal, force?: boolean}} [options]
   * @returns {Promise<string>}
   */
  async ensureContainer(options = {}) {
    if (this.containerPath !== undefined) return this.containerPath
    const now = Date.now()
    if (!options.force && now - this.lastAttempt < RESOLVE_RETRY_MS && this.error !== undefined) throw this.error
    this.lastAttempt = now
    const configured = typeof this.config.containerPath === 'string' && this.config.containerPath.trim() !== '' ? this.config.containerPath.trim() : null
    if (configured !== null) {
      const path = isAbsolute(configured) ? configured : resolve(this.home, configured)
      if (executable(path)) {
        this.containerPath = path
        this.error = undefined
        return path
      }
      const error = new AppleCliError(`配置的 containerPath 不可执行: ${configured}`, 'container/cli-missing', { candidates: [configured] })
      this.error = error
      throw error
    }
    for (const candidate of this.candidates()) {
      const path = isAbsolute(candidate) ? candidate : resolve(this.home, candidate)
      if (executable(path)) {
        this.containerPath = path
        this.error = undefined
        return path
      }
    }
    const onPath = await this.resolveOnPath(options.signal)
    if (onPath !== undefined && executable(onPath)) {
      this.containerPath = onPath
      this.error = undefined
      return onPath
    }
    const error = new AppleCliError(
      '未找到 Apple container 命令。请安装 container（macOS 26 / Apple silicon）并执行 container system start。',
      'container/cli-missing',
      { candidates: this.candidates() },
    )
    this.error = error
    throw error
  }

  /** @returns {NodeJS.ProcessEnv} */
  childEnv() {
    const pathParts = []
    if (typeof this.containerPath === 'string') pathParts.push(dirname(this.containerPath))
    pathParts.push('/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin')
    if (typeof this.env.PATH === 'string') pathParts.push(...this.env.PATH.split(':'))
    return {
      PATH: [...new Set(pathParts.filter(Boolean))].join(':'),
      NO_COLOR: '1',
      CLICOLOR: '0',
      TERM: 'dumb',
      CONTAINER_DEBUG: '0',
    }
  }

  /** @param {string} path */
  markMissing(path) {
    if (this.containerPath === path) {
      this.containerPath = undefined
      this.error = undefined
      this.lastAttempt = 0
    }
  }

  /**
   * @param {string[]} subargv
   * @param {{cwd?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number}} [options]
   */
  async exec(subargv, options = {}) {
    const path = await this.ensureContainer({ signal: options.signal })
    const maxBytes = clampBytes(Number(options.maxBytes ?? this.maxOutput), this.maxOutput)
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs ?? DEFAULT_TIMEOUT), 1000), 10 * 60_000)
    const abort = new AbortController()
    let timedOut = false
    const onAbort = () => abort.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) abort.abort(options.signal.reason)
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort(new Error('container command timed out'))
    }, timeoutMs)
    timeout.unref?.()

    let handle
    try {
      handle = this.subprocess.spawn({
        argv: [path, ...subargv],
        cwd: options.cwd ?? this.home,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
        graceMs: 2000,
        env: this.childEnv(),
        signal: abort.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      throw new AppleCommandError(`无法启动 container: ${messageOf(error)}`, { code: 'container/exec-failed' })
    }

    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      this.markMissing(path)
      throw new AppleCommandError(`container 进程失败: ${messageOf(error)}`, { code: 'container/exec-failed' })
    }
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
    const stdout = handle.collected?.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
    return { exitCode: outcome.exitCode, signal: outcome.signal, stdout, stderr, timedOut, argv: [path, ...subargv] }
  }

  /**
   * Execute and require a zero exit code.
   * @param {string[]} subargv
   * @param {{cwd?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number}} [options]
   */
  async ok(subargv, options = {}) {
    const result = await this.exec(subargv, options)
    if (result.timedOut || result.exitCode !== 0) {
      const detail = summarizeStderr(result.stderr)
      throw new AppleCommandError(
        result.timedOut ? `container ${subargv[0] ?? ''} 超时` : detail.trim() === '' ? `container ${subargv[0] ?? ''} 退出码 ${String(result.exitCode)}` : detail,
        {
          code: result.timedOut ? 'container/timeout' : 'container/exec-failed',
          stderr: result.stderr,
          details: { argv: result.argv, exitCode: result.exitCode, timedOut: result.timedOut },
        },
      )
    }
    return result
  }

  /**
   * @param {string[]} subargv
   * @param {{cwd?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number}} [options]
   */
  async json(subargv, options = {}) {
    const result = await this.ok(subargv, options)
    try {
      return JSON.parse(result.stdout)
    } catch (error) {
      throw new AppleCommandError(`无法解析 container JSON: ${messageOf(error)}`, {
        code: 'container/protocol',
        stderr: result.stderr,
        details: { stdout: result.stdout.slice(0, 2000) },
      })
    }
  }

  /** @param {AbortSignal | undefined} signal */
  async systemStatus(signal) {
    try {
      const result = await this.exec(['system', 'status', '--format', 'json'], { signal, timeoutMs: 10_000 })
      if (result.exitCode !== 0) {
        return { status: 'unavailable', error: summarizeStderr(result.stderr) || `exit ${String(result.exitCode)}`, raw: null }
      }
      return JSON.parse(result.stdout)
    } catch (error) {
      return { status: 'unavailable', error: messageOf(error), raw: null }
    }
  }

  /** @param {AbortSignal | undefined} signal */
  async systemVersion(signal) {
    try {
      const raw = await this.json(['system', 'version', '--format', 'json'], { signal, timeoutMs: 10_000 })
      return Array.isArray(raw) ? raw : [raw]
    } catch {
      return []
    }
  }

  /** @param {AbortSignal | undefined} signal */
  async df(signal) {
    return this.json(['system', 'df', '--format', 'json'], { signal, timeoutMs: 30_000 })
  }

  /**
   * `container system status` has reported `unregistered` on installs where the
   * apiserver is still reachable; a lightweight list is the authoritative
   * health probe. Returns undefined when the service is not reachable.
   * @param {AbortSignal | undefined} signal
   */
  async probe(signal) {
    try {
      const raw = await this.json(['list', '-a', '--format', 'json'], { signal, timeoutMs: 10_000 })
      return Array.isArray(raw) ? raw : []
    } catch {
      return undefined
    }
  }

  /** @param {string} path */
  static commandName(path) {
    return basename(path)
  }
}
