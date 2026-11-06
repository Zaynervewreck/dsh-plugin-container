/**
 * Apple `container` provider.
 *
 * Read-only discovery uses `container system status/version` and the JSON list
 * commands; mutations are normal jobs through the same JobManager used by the
 * Docker provider. There is no Docker context, image store, or Compose here.
 */
import { cpus, homedir, totalmem } from 'node:os'
import { statSync } from 'node:fs'

import {
  CommandError,
  describeCommand,
  detectDestructive,
  normalizeSubcommand,
  parseArguments,
  parseCommand,
  resolveCwd,
} from './commands.js'
import { AppleCli } from './apple-cli.js'
import { LONG_JOB_MS, buildArgv, buildSpec, platformOf, pushSpec } from './images.js'
import { JobManager } from './jobs.js'
import {
  firstLine,
  normalizeAppleContainer,
  normalizeAppleImage,
  normalizeAppleNetwork,
  normalizeAppleVolume,
  parseAppleDf,
  parseAppleSystemStatus,
  parseAppleSystemVersion,
  summarizeStderr,
} from './parsers.js'
import { messageOf, optionalInteger, requireString } from './util.js'

const VALUE_CACHE_MS = 1500

/** @param {string} value */
function safeId(value) {
  const id = requireString(value, 'id', { max: 256 })
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/u.test(id)) throw new CommandError('资源 ID 不合法')
  return id
}

/** @param {string} value */
function safeImageRef(value) {
  const reference = requireString(value, 'reference', { max: 512 })
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/u.test(reference)) throw new CommandError('镜像名不合法')
  return reference
}

/** @param {unknown} value @param {string} field */
function stringList(value, field) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new CommandError(`${field} 必须是字符串数组`)
  if (value.length > 64) throw new CommandError(`${field} 数量过多`)
  return value.map((entry, index) => requireString(entry, `${field}[${String(index)}]`, { max: 512 }))
}

/** @param {string} value */
function safePort(value) {
  if (!/^(?:(?:\d{1,3}\.){3}\d{1,3}:)?\d{1,5}:\d{1,5}(?:\/(?:tcp|udp))?$/u.test(value) && !/^\d{1,5}(?:\/(?:tcp|udp))?$/u.test(value)) {
    throw new CommandError(`端口格式不合法: ${value}（示例 8080:80）`)
  }
  return value
}

/** @param {string} value */
function safeEnv(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*=[^\r\n]*$/u.test(value)) throw new CommandError(`环境变量格式不合法: ${value}（示例 KEY=VALUE）`)
  return value
}

export class AppleProvider {
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
    this.config = options.config ?? {}
    this.home = options.home ?? homedir()
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.logger = options.logger
    this.controlEnabled = this.platform === 'darwin' && this.config.enableRuntimeControl !== false
    this.cli = new AppleCli({
      subprocess: options.subprocess,
      config: this.config,
      env: this.env,
      home: this.home,
      platform: this.platform,
      logger: this.logger,
    })
    this.jobs = new JobManager({
      subprocess: options.subprocess,
      cli: this.cli,
      maxOutputBytes: Number(this.config.maxOutputBytes ?? 1024 * 1024),
      maxRuns: Number(this.config.maxConcurrentRuns ?? 4),
      idPrefix: 'apple',
    })
    this.cache = new Map()
  }

  /** @param {AbortSignal | undefined} signal */
  async info(signal) {
    let path = null
    try {
      path = await this.cli.ensureContainer({ signal, force: true })
    } catch (error) {
      return {
        id: 'apple-container',
        label: 'Apple container',
        available: false,
        running: false,
        version: null,
        detail: messageOf(error),
      }
    }
    const status = parseAppleSystemStatus(await this.cli.systemStatus(signal))
    const probe = status.status === 'running' ? undefined : await this.cli.probe(signal)
    const running = status.status === 'running' || probe !== undefined
    const versions = parseAppleSystemVersion(await this.cli.systemVersion(signal))
    return {
      id: 'apple-container',
      label: 'Apple container',
      available: true,
      running,
      version: versions.containerVersion || null,
      detail: path,
    }
  }

  invalidate() {
    this.cache.clear()
  }

  /** @param {string} key @param {() => Promise<any>} produce */
  async cached(key, produce) {
    const now = Date.now()
    const hit = this.cache.get(key)
    if (hit !== undefined && now - hit.at < VALUE_CACHE_MS) return hit.value
    const value = await produce()
    this.cache.set(key, { at: now, value })
    return value
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async status(payload, signal) {
    let path = null
    let cliError = null
    try {
      path = await this.cli.ensureContainer({ signal })
    } catch (error) {
      cliError = error
    }
    const system = path === null
      ? { status: 'unavailable', error: messageOf(cliError), raw: null }
      : parseAppleSystemStatus(await this.cli.systemStatus(signal))
    if (path !== null && system.status !== 'running') {
      const probe = await this.cli.probe(signal)
      if (probe !== undefined) {
        system.status = 'running'
        system.error = null
      }
    }
    const versions = path === null ? { containerVersion: '', apiServerVersion: '', components: [] } : parseAppleSystemVersion(await this.cli.systemVersion(signal))
    let df = null
    let dfError = null
    if (path !== null && system.status === 'running') {
      try {
        df = await this.cli.df(signal)
      } catch (error) {
        dfError = messageOf(error)
      }
    }
    const running = system.status === 'running'
    const daemonState = running ? 'running' : system.status === 'unavailable' || system.status === 'error' ? 'unreachable' : 'stopped'
    const server = {
      name: 'container-apiserver',
      version: versions.apiServerVersion || system.apiServerVersion || '',
      ncpu: cpus().length,
      memTotal: totalmem(),
      containers: Number(df?.containers?.total) || 0,
      containersRunning: Number(df?.containers?.active) || 0,
      containersStopped: Math.max(0, (Number(df?.containers?.total) || 0) - (Number(df?.containers?.active) || 0)),
      images: Number(df?.images?.total) || 0,
      operatingSystem: 'Apple container',
      architecture: this.platform === 'darwin' ? 'arm64' : this.platform,
    }
    const warnings = []
    if (typeof system.error === 'string' && system.error !== '') warnings.push(firstLine(system.error))
    if (dfError) warnings.push(firstLine(dfError))
    const value = {
      provider: 'apple-container',
      fetchedAt: Date.now(),
      platform: this.platform,
      cli: {
        installed: path !== null,
        path,
        version: versions.containerVersion || null,
        error: cliError === null ? null : messageOf(cliError),
      },
      daemon: {
        state: daemonState,
        error: typeof system.error === 'string' && system.error !== '' ? summarizeStderr(system.error) : null,
      },
      context: {
        selected: null,
        current: null,
        endpoint: '',
        description: 'Apple container',
        contexts: [],
      },
      client: {
        version: versions.containerVersion || null,
        context: null,
        os: 'darwin',
        arch: 'arm64',
      },
      server,
      runtime: {
        kind: 'apple-container',
        label: 'Apple container',
        profile: null,
        installed: path !== null,
        running,
        vmRunning: running,
        canStart: this.controlEnabled && path !== null && !running,
        canStop: this.controlEnabled && path !== null && running,
        canRestart: false,
        endpoint: '',
        details: {
          system: system.raw ?? null,
          status: system.status,
          components: versions.components,
          disk: df,
        },
        error: system.error ?? dfError ?? (cliError === null ? null : messageOf(cliError)),
      },
      env: {
        dockerHost: false,
        dockerContext: null,
      },
      capabilities: {
        enableRuntimeControl: this.controlEnabled,
        maxOutputBytes: Number(this.config.maxOutputBytes ?? 1024 * 1024),
        defaultTimeoutMs: Number(this.config.defaultTimeoutMs ?? 120_000),
        compose: false,
        contexts: false,
      },
      warnings,
    }
    return value
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async list(payload, signal) {
    const resource = requireString(payload.resource, 'resource')
    const all = payload.all !== false
    const key = `${resource}:${all ? 'all' : 'running'}`
    return this.cached(key, async () => {
      let items
      let format = 'json'
      if (resource === 'containers') {
        const raw = await this.cli.json(['list', ...(all ? ['-a'] : []), '--format', 'json'], { signal })
        items = (Array.isArray(raw) ? raw : []).map(normalizeAppleContainer)
      } else if (resource === 'images') {
        const raw = await this.cli.json(['image', 'list', '--format', 'json'], { signal })
        items = (Array.isArray(raw) ? raw : []).map(normalizeAppleImage)
      } else if (resource === 'volumes') {
        const raw = await this.cli.json(['volume', 'list', '--format', 'json'], { signal })
        items = (Array.isArray(raw) ? raw : []).map(normalizeAppleVolume)
      } else if (resource === 'networks') {
        const raw = await this.cli.json(['network', 'list', '--format', 'json'], { signal })
        items = (Array.isArray(raw) ? raw : []).map(normalizeAppleNetwork)
      } else if (resource === 'disk') {
        const raw = await this.cli.json(['system', 'df', '--format', 'json'], { signal })
        items = parseAppleDf(raw)
      } else if (resource === 'compose') {
        throw new CommandError('Apple container 不支持 Compose；请切换到 Docker provider', 'container/unsupported')
      } else {
        throw new CommandError(`不支持的资源类型: ${resource}`)
      }
      return { fetchedAt: Date.now(), items, format, warnings: [] }
    })
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async inspect(payload, signal) {
    const kind = requireString(payload.kind, 'kind')
    const command = {
      container: ['inspect', safeId(payload.id)],
      image: ['image', 'inspect', safeId(payload.id)],
      volume: ['volume', 'inspect', safeId(payload.id)],
      network: ['network', 'inspect', safeId(payload.id)],
    }[kind]
    if (command === undefined) throw new CommandError('不支持的 inspect 类型')
    const raw = await this.cli.json(command, { signal, timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 })
    const value = Array.isArray(raw) ? raw[0] ?? null : raw
    return { value, raw: JSON.stringify(value, null, 2), warnings: [] }
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async run(payload, signal) {
    const path = await this.cli.ensureContainer({ signal })
    let subargv
    if (payload.argv !== undefined) {
      if (payload.command !== undefined) throw new CommandError('command 和 argv 只能提供一个')
      subargv = normalizeSubcommand(payload.argv, { dockerPath: path, commandName: 'container' })
    } else {
      subargv = parseCommand(requireString(payload.command, 'command'), { dockerPath: path, commandName: 'container' })
    }
    const cwd = resolveCwd(payload.cwd, { fallback: this.home, statSync })
    const displayCommand = describeCommand(subargv, null, 'container')
    const destructive = detectDestructive(subargv)
    if (destructive.dangerous && payload.confirm !== true) {
      throw Object.assign(new Error(`危险操作需要确认: ${displayCommand}`), {
        code: 'docker/confirmation-required',
        details: { command: displayCommand, reason: destructive.reason },
      })
    }
    const timeoutMs = optionalInteger(payload.timeoutMs, 'timeoutMs', { min: 5000, max: 30 * 60_000 }) ?? Number(this.config.defaultTimeoutMs ?? 120_000)
    const run = this.jobs.start({
      argv: [path, ...subargv],
      displayCommand,
      context: null,
      cwd,
      title: typeof payload.title === 'string' ? payload.title : '',
      timeoutMs,
    })
    this.invalidate()
    return { run }
  }

  /**
   * Semantic quick action mapped to Apple CLI syntax.
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async action(payload, signal) {
    const kind = requireString(payload.kind, 'kind')
    const action = requireString(payload.action, 'action')
    if (kind === 'container' && action === 'run') {
      const image = safeImageRef(payload.image)
      const name = payload.name === undefined || payload.name === null ? undefined : safeId(payload.name)
      const args = parseArguments(payload.command === undefined || payload.command === null ? '' : requireString(payload.command, 'command'))
      const ports = stringList(payload.ports, 'ports').map(safePort)
      const env = stringList(payload.env, 'env').map(safeEnv)
      const argv = [
        'run',
        '-d',
        ...(name === undefined ? [] : ['--name', name]),
        ...ports.flatMap((port) => ['-p', port]),
        ...env.flatMap((entry) => ['-e', entry]),
        image,
        ...args,
      ]
      return this.run({
        argv,
        cwd: payload.cwd,
        title: payload.title ?? `container run ${image}`,
      }, signal)
    }
    if (kind === 'container') {
      const id = safeId(payload.id)
      if (action === 'restart') throw new CommandError('Apple container 不支持一键重启；请先停止再启动', 'container/unsupported')
      const argv = action === 'start'
        ? ['start', id]
        : action === 'stop'
          ? ['stop', id]
          : action === 'delete'
            ? ['delete', id]
            : action === 'logs'
              ? ['logs', ...(payload.follow === true ? ['-f', '-n', '100'] : ['-n', '500']), id]
              : undefined
      if (argv === undefined) throw new CommandError(`不支持的操作: ${action}`)
      return this.run({ argv, confirm: payload.confirm, cwd: payload.cwd, title: payload.title ?? `container ${action} ${id}` }, signal)
    }
    if (kind === 'image') {
      if (action === 'pull') {
        const platform = platformOf(payload.platform)
        return this.run({ argv: ['image', 'pull', ...(platform === undefined ? [] : ['--platform', platform]), safeImageRef(payload.id ?? payload.reference)], cwd: payload.cwd, title: payload.title ?? 'container image pull' }, signal)
      }
      if (action === 'build') {
        const spec = buildSpec(payload)
        return this.run({ argv: buildArgv(spec), cwd: spec.contextDir, timeoutMs: LONG_JOB_MS, title: payload.title ?? `container build ${spec.tag}` }, signal)
      }
      if (action === 'push') {
        const { source, target } = pushSpec(payload)
        if (target !== source) {
          const tagged = await this.cli.exec(['image', 'tag', source, target], { signal, cwd: this.home, timeoutMs: 20_000 })
          if (tagged.exitCode !== 0) throw new CommandError(`${tagged.stderr}${tagged.stdout}`.trim() || `container image tag 退出码 ${String(tagged.exitCode)}`, 'container/exec-failed')
        }
        return this.run({ argv: ['image', 'push', target], cwd: payload.cwd, timeoutMs: LONG_JOB_MS, title: payload.title ?? `container image push ${target}` }, signal)
      }
      if (action === 'delete') {
        return this.run({ argv: ['image', 'delete', safeId(payload.id)], confirm: payload.confirm, cwd: payload.cwd, title: payload.title ?? 'container image delete' }, signal)
      }
      throw new CommandError(`不支持的镜像操作: ${action}`)
    }
    if (kind === 'volume') {
      if (action !== 'delete') throw new CommandError(`不支持的卷操作: ${action}`)
      return this.run({ argv: ['volume', 'delete', safeId(payload.id)], confirm: payload.confirm, cwd: payload.cwd, title: payload.title ?? 'container volume delete' }, signal)
    }
    if (kind === 'network') {
      if (action !== 'delete') throw new CommandError(`不支持的网络操作: ${action}`)
      return this.run({ argv: ['network', 'delete', safeId(payload.id)], confirm: payload.confirm, cwd: payload.cwd, title: payload.title ?? 'container network delete' }, signal)
    }
    throw new CommandError(`不支持的资源类型: ${kind}`)
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async runtimeAction(payload, signal) {
    const action = requireString(payload.action, 'action')
    if (action !== 'start' && action !== 'stop') throw new CommandError('Apple container 只支持 system start/stop', 'container/unsupported')
    if (action === 'stop' && payload.confirm !== true) {
      throw Object.assign(new Error('停止 Apple container 系统服务会中断所有容器'), {
        code: 'docker/confirmation-required',
        details: { command: 'container system stop', reason: 'runtime-stop' },
      })
    }
    const path = await this.cli.ensureContainer({ signal })
    const argv = action === 'start'
      ? [path, 'system', 'start', '--disable-kernel-install', '--timeout', '120']
      : [path, 'system', 'stop']
    const displayCommand = action === 'start'
      ? 'container system start --disable-kernel-install --timeout 120'
      : 'container system stop'
    const run = this.jobs.start({
      argv,
      displayCommand,
      context: null,
      cwd: this.home,
      title: action === 'start' ? 'container system start' : 'container system stop',
      timeoutMs: 10 * 60_000,
    })
    this.invalidate()
    return { run, dispatched: true, message: displayCommand }
  }

  /** @param {Record<string, any>} payload */
  poll(payload) {
    const runId = requireString(payload.runId, 'runId')
    return this.jobs.poll({
      runId,
      stdoutOffset: optionalInteger(payload.stdoutOffset, 'stdoutOffset', { min: 0 }),
      stderrOffset: optionalInteger(payload.stderrOffset, 'stderrOffset', { min: 0 }),
    })
  }

  /** @param {Record<string, any>} payload */
  cancel(payload) {
    return this.jobs.cancel(requireString(payload.runId, 'runId'))
  }

  dispose() {
    this.jobs.dispose()
    this.cache.clear()
  }
}

export function createAppleProvider(options) {
  return new AppleProvider(options)
}
