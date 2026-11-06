/**
 * Docker CLI discovery and fully-specified child process execution.
 *
 * No shell is involved: every command is an argv array handed to the
 * subprocess seam. The CLI path is pinned for the lifetime of a process but
 * re-resolved when a status check fails with a missing executable.
 */
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

import { codeOf, messageOf } from './util.js'
import { summarizeStderr } from './parsers.js'

const DEFAULT_MAX_OUTPUT = 1024 * 1024
const DEFAULT_QUERY_TIMEOUT = 20_000
const RESOLVE_RETRY_MS = 10_000

export class DockerCliError extends Error {
  /** @param {string} message @param {string} [code] @param {Record<string, unknown>} [details] */
  constructor(message, code = 'docker/cli-missing', details = {}) {
    super(message)
    this.name = 'DockerCliError'
    this.code = code
    this.details = details
  }
}

export class DockerCommandError extends Error {
  /** @param {string} message @param {{code?: string, stderr?: string, details?: Record<string, unknown>}} [options] */
  constructor(message, options = {}) {
    super(message)
    this.name = 'DockerCommandError'
    this.code = options.code ?? 'docker/exec-failed'
    this.stderr = options.stderr ?? ''
    this.details = options.details ?? {}
  }
}

/** @param {number} bytes */
function clampBytes(bytes) {
  if (!Number.isFinite(bytes)) return DEFAULT_MAX_OUTPUT
  return Math.min(Math.max(Math.trunc(bytes), 64 * 1024), 8 * 1024 * 1024)
}

/** @param {string} value */
function executable(path) {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export class DockerCli {
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
    this.maxOutput = clampBytes(Number(this.config.maxOutputBytes ?? DEFAULT_MAX_OUTPUT))
    this.queryTimeoutMs = Number(this.config.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT)
    this.dockerPath = undefined
    this.colimaPath = undefined
    this.dockerError = undefined
    this.lastDockerAttempt = 0
    this.lastColimaAttempt = 0
  }

  /** @returns {string[]} */
  dockerCandidates() {
    const configured = typeof this.config.dockerPath === 'string' && this.config.dockerPath.trim() !== '' ? this.config.dockerPath.trim() : null
    const envPath = typeof this.env.DOCKER_PATH === 'string' && this.env.DOCKER_PATH.trim() !== '' ? this.env.DOCKER_PATH.trim() : null
    return [
      configured,
      envPath,
      '/opt/homebrew/bin/docker',
      '/usr/local/bin/docker',
      join(this.home, '.docker/bin/docker'),
      '/Applications/Docker.app/Contents/Resources/bin/docker',
    ].filter((value, index, list) => typeof value === 'string' && value !== '' && list.indexOf(value) === index)
  }

  /** @returns {string[]} */
  colimaCandidates() {
    const configured = typeof this.config.colimaPath === 'string' && this.config.colimaPath.trim() !== '' ? this.config.colimaPath.trim() : null
    return [
      configured,
      '/opt/homebrew/bin/colima',
      '/usr/local/bin/colima',
      join(this.home, 'go/bin/colima'),
    ].filter((value, index, list) => typeof value === 'string' && value !== '' && list.indexOf(value) === index)
  }

  /** @param {string} command @param {AbortSignal | undefined} signal */
  async resolveOnPath(command, signal) {
    if (typeof this.subprocess.resolveExecutable !== 'function') return undefined
    try {
      return await this.subprocess.resolveExecutable(command, undefined, signal)
    } catch (error) {
      if (error?.name === 'SubprocessExecutableNotFoundError' || codeOf(error) === 'ENOENT') return undefined
      throw error
    }
  }

  /**
   * @param {{signal?: AbortSignal, force?: boolean}} [options]
   * @returns {Promise<string>}
   */
  async ensureDocker(options = {}) {
    if (this.dockerPath !== undefined) return this.dockerPath
    const now = Date.now()
    if (!options.force && now - this.lastDockerAttempt < RESOLVE_RETRY_MS && this.dockerError !== undefined) throw this.dockerError
    this.lastDockerAttempt = now
    const configured = typeof this.config.dockerPath === 'string' && this.config.dockerPath.trim() !== '' ? this.config.dockerPath.trim() : null
    if (configured !== null) {
      const path = isAbsolute(configured) ? configured : resolve(this.home, configured)
      if (executable(path)) {
        this.dockerPath = path
        this.dockerError = undefined
        return path
      }
      const error = new DockerCliError(
        `配置的 dockerPath 不可执行: ${configured}`,
        'docker/cli-missing',
        { candidates: [configured] },
      )
      this.dockerError = error
      throw error
    }
    for (const candidate of this.dockerCandidates()) {
      if (candidate === configured) continue
      const path = isAbsolute(candidate) ? candidate : resolve(this.home, candidate)
      if (executable(path)) {
        this.dockerPath = path
        this.dockerError = undefined
        return path
      }
    }
    const onPath = await this.resolveOnPath('docker', options.signal)
    if (onPath !== undefined && executable(onPath)) {
      this.dockerPath = onPath
      this.dockerError = undefined
      return onPath
    }
    const error = new DockerCliError(
      '未找到 docker 命令。请安装 Docker Desktop，或安装 colima 并启动运行时。',
      'docker/cli-missing',
      { candidates: this.dockerCandidates() },
    )
    this.dockerError = error
    throw error
  }

  /**
   * @param {{signal?: AbortSignal, force?: boolean}} [options]
   * @returns {Promise<string | null>}
   */
  async ensureColima(options = {}) {
    if (this.colimaPath !== undefined) return this.colimaPath
    const now = Date.now()
    if (!options.force && now - this.lastColimaAttempt < RESOLVE_RETRY_MS && this.colimaPath === null) return null
    this.lastColimaAttempt = now
    const configured = typeof this.config.colimaPath === 'string' && this.config.colimaPath.trim() !== '' ? this.config.colimaPath.trim() : null
    if (configured !== null) {
      const path = isAbsolute(configured) ? configured : resolve(this.home, configured)
      if (executable(path)) {
        this.colimaPath = path
        return path
      }
      this.colimaPath = null
      return null
    }
    for (const candidate of this.colimaCandidates()) {
      const path = isAbsolute(candidate) ? candidate : resolve(this.home, candidate)
      if (executable(path)) {
        this.colimaPath = path
        return path
      }
    }
    const onPath = await this.resolveOnPath('colima', options.signal)
    if (onPath !== undefined && executable(onPath)) {
      this.colimaPath = onPath
      return onPath
    }
    this.colimaPath = null
    return null
  }

  /** @param {string} path */
  markDockerMissing(path) {
    if (this.dockerPath === path) {
      this.dockerPath = undefined
      this.dockerError = undefined
      this.lastDockerAttempt = 0
    }
  }

  /** @returns {NodeJS.ProcessEnv} */
  childEnv() {
    const pathParts = []
    if (this.dockerPath !== undefined) pathParts.push(dirname(this.dockerPath))
    if (typeof this.colimaPath === 'string') pathParts.push(dirname(this.colimaPath))
    pathParts.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin')
    if (typeof this.env.PATH === 'string') pathParts.push(...this.env.PATH.split(':'))
    const PATH = [...new Set(pathParts.filter(Boolean))].join(':')
    return {
      PATH,
      NO_COLOR: '1',
      CLICOLOR: '0',
      TERM: 'dumb',
      DOCKER_CLI_HINTS: 'false',
      DOCKER_CLIENT_TIMEOUT: String(this.config.dockerClientTimeoutSec ?? 10),
      COMPOSE_HTTP_TIMEOUT: String(this.config.composeHttpTimeoutSec ?? 20),
    }
  }

  /**
   * @param {string[]} subargv
   * @param {{context?: string | null, cwd?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number}} [options]
   */
  argvFor(subargv, options = {}) {
    const path = this.dockerPath
    if (path === undefined) throw new DockerCliError('docker 尚未解析', 'docker/cli-missing')
    return [path, ...(options.context ? ['--context', options.context] : []), ...subargv]
  }

  /**
   * Execute one Docker command and collect bounded stdout/stderr.
   * @param {string[]} argv fully-resolved argv including the docker path
   * @param {{cwd?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number}} [options]
   */
  async exec(argv, options = {}) {
    const maxBytes = clampBytes(options.maxBytes ?? this.maxOutput)
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs ?? this.queryTimeoutMs), 1000), 10 * 60_000)
    const abort = new AbortController()
    let timedOut = false
    const onAbort = () => abort.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) abort.abort(options.signal.reason)
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort(new Error('docker command timed out'))
    }, timeoutMs)
    timeout.unref?.()

    let handle
    try {
      handle = this.subprocess.spawn({
        argv,
        cwd: options.cwd ?? this.home,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
        graceMs: 2000,
        env: this.childEnv(),
        signal: abort.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      throw new DockerCommandError(`无法启动 docker: ${messageOf(error)}`, { code: 'docker/exec-failed' })
    }

    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      this.markDockerMissing(argv[0])
      throw new DockerCommandError(`docker 进程失败: ${messageOf(error)}`, { code: 'docker/exec-failed' })
    }
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)

    const read = (reader) => {
      if (reader === undefined) return { text: '', truncated: false }
      const value = reader.readFrom(0)
      return { text: value.text, truncated: value.lossy === true, nextOffset: value.nextOffset }
    }
    const stdout = read(handle.collected?.stdout)
    const stderr = read(handle.collected?.stderr)
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      timedOut,
      argv,
    }
  }

  /**
   * Execute a Docker subcommand with the selected context and parse-friendly
   * error reporting.
   * @param {string[]} subargv
   * @param {{context?: string | null, cwd?: string, timeoutMs?: number, signal?: AbortSignal, maxBytes?: number}} [options]
   */
  async docker(subargv, options = {}) {
    const path = await this.ensureDocker({ signal: options.signal })
    const argv = this.argvFor(subargv, options)
    const result = await this.exec(argv, { ...options, cwd: options.cwd ?? this.home })
    if (result.timedOut || result.exitCode !== 0) {
      const detail = summarizeStderr(result.stderr)
      throw new DockerCommandError(
        result.timedOut
          ? `docker 命令超时（${subargv[0] ?? ''}）`
          : detail.trim() === ''
            ? `docker ${subargv[0] ?? ''} 退出码 ${String(result.exitCode)}`
            : detail,
        {
          code: result.timedOut ? 'docker/timeout' : 'docker/exec-failed',
          stderr: result.stderr,
          details: {
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            argv,
          },
        },
      )
    }
    return { ...result, path }
  }

  /**
   * Execute a non-docker helper (colima/open/osascript) and collect output.
   * @param {string} command absolute path or PATH name
   * @param {string[]} args
   * @param {{timeoutMs?: number, signal?: AbortSignal, maxBytes?: number, cwd?: string}} [options]
   */
  async program(command, args, options = {}) {
    const maxBytes = clampBytes(options.maxBytes ?? this.maxOutput)
    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs ?? this.queryTimeoutMs), 1000), 30 * 60_000)
    const abort = new AbortController()
    let timedOut = false
    const onAbort = () => abort.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    if (options.signal?.aborted === true) abort.abort(options.signal.reason)
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort(new Error('command timed out'))
    }, timeoutMs)
    timeout.unref?.()
    let handle
    try {
      handle = this.subprocess.spawn({
        argv: [command, ...args],
        cwd: options.cwd ?? this.home,
        stdio: { stdin: 'ignore', stdout: { maxBytes }, stderr: { maxBytes } },
        graceMs: 2000,
        env: this.childEnv(),
        signal: abort.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      throw new DockerCommandError(`无法启动 ${basename(command)}: ${messageOf(error)}`, { code: 'docker/exec-failed' })
    }
    let outcome
    try {
      outcome = await handle.done
    } catch (error) {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
      throw new DockerCommandError(`${basename(command)} 进程失败: ${messageOf(error)}`, { code: 'docker/exec-failed' })
    }
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
    const stdout = handle.collected?.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
    if (timedOut || outcome.exitCode !== 0) {
      throw new DockerCommandError(
        timedOut ? `${basename(command)} 超时` : summarizeStderr(stderr) || `${basename(command)} 退出码 ${String(outcome.exitCode)}`, {
        code: timedOut ? 'docker/timeout' : 'docker/exec-failed',
        stderr,
        details: { command, args, exitCode: outcome.exitCode, timedOut },
      })
    }
    return { stdout, stderr, exitCode: outcome.exitCode, signal: outcome.signal, timedOut }
  }

  /** @param {string} endpoint */
  static isLocalEndpoint(endpoint) {
    return /^(?:unix|npipe):/iu.test(String(endpoint ?? ''))
  }

  /** @param {string} path */
  static commandName(path) {
    return basename(path)
  }
}
