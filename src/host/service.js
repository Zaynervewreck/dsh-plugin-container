/**
 * Host-side Docker service exposed to the browser over the Connection generic
 * RPC channel `/docker`.
 *
 * Every method returns `{ok:true,value}` or `{ok:false,error}`. There is no
 * shell, no model-facing tool, and no persistence: query caches and command
 * records live in this plugin's memory and disappear on unload.
 */
import { homedir } from 'node:os'
import { statSync } from 'node:fs'

import {
  CommandError,
  describeCommand,
  detectDestructive,
  normalizeContext,
  normalizeSubcommand,
  parseArguments,
  parseCommand,
  resolveCwd,
} from './commands.js'
import { AppleProvider } from './apple.js'
import { AttachManager } from './attach.js'
import { AppleCliError, AppleCommandError } from './apple-cli.js'
import { DockerCli, DockerCliError, DockerCommandError } from './docker-cli.js'
import { LONG_JOB_MS, buildArgv, buildSpec, inspectBuildContext, platformOf, pushSpec } from './images.js'
import { JobManager } from './jobs.js'
import {
  firstLine,
  mapDockerInfo,
  mapDockerVersion,
  normalizeContainer,
  normalizeImage,
  normalizeNetwork,
  normalizeVolume,
  parseComposeList,
  parseContexts,
  parseNdjson,
  parseSystemDf,
  summarizeStderr,
} from './parsers.js'
import { createRuntimeResolver } from './runtime.js'
import { codeOf, isRecord, messageOf, optionalInteger, requireString } from './util.js'

const STATUS_CACHE_MS = 1500
const CONTEXT_CACHE_MS = 10_000
const VALUE_CACHE_MS = 1500

/** @param {unknown} value */
function ok(value) {
  return { ok: true, value }
}

/** @param {string} code @param {string} message @param {Record<string, unknown>} [details] */
function fail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}

/** @param {unknown} error */
function failureFrom(error) {
  if (error instanceof DockerCliError || error instanceof DockerCommandError || error instanceof AppleCliError || error instanceof AppleCommandError || error instanceof CommandError) {
    return fail(error.code ?? 'docker/internal', error.message, {
      ...(error.details ?? {}),
      ...(error.stderr !== undefined ? { stderr: summarizeStderr(error.stderr) } : {}),
    })
  }
  if (codeOf(error) !== undefined) return fail(codeOf(error), messageOf(error), error?.details ?? {})
  return fail('docker/internal', messageOf(error))
}

/** @param {unknown} value */
function payloadOf(value) {
  if (value === undefined || value === null) return {}
  if (!isRecord(value)) throw new CommandError('请求参数必须是对象')
  return value
}

/** @param {unknown} value @param {string} field */
function optionalString(value, field) {
  if (value === undefined || value === null) return undefined
  return requireString(value, field)
}

/** @param {unknown} value */
function optionalBoolean(value) {
  return value === true
}

/** @param {string} value */
function safeIdentifier(value) {
  const id = requireString(value, 'id', { max: 256 })
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:/@-]{0,255}$/u.test(id)) throw new CommandError('资源 ID 不合法')
  return id
}

/** @param {unknown} value */
function safeImageRef(value) {
  const reference = requireString(value, 'image', { max: 512 })
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

export class DockerService {
  /**
   * @param {{
   *   subprocess: any,
   *   logger?: any,
   *   config?: Record<string, any>,
   *   env?: NodeJS.ProcessEnv,
   *   home?: string,
   *   platform?: NodeJS.Platform,
   * }} options
   */
  constructor(options) {
    this.logger = options.logger
    this.config = options.config ?? {}
    this.home = options.home ?? homedir()
    this.env = options.env ?? process.env
    this.cli = new DockerCli({
      subprocess: options.subprocess,
      config: this.config,
      env: this.env,
      home: this.home,
      platform: options.platform,
      logger: this.logger,
    })
    this.jobs = new JobManager({
      subprocess: options.subprocess,
      cli: this.cli,
      maxOutputBytes: Number(this.config.maxOutputBytes ?? 1024 * 1024),
      maxRuns: Number(this.config.maxConcurrentRuns ?? 4),
      idPrefix: 'docker',
    })
    this.runtime = createRuntimeResolver({
      cli: this.cli,
      platform: options.platform,
      env: this.env,
      config: this.config,
    })
    this.attach = new AttachManager({
      subprocess: options.subprocess,
      maxBytes: Number(this.config.maxOutputBytes ?? 1024 * 1024),
      maxSessions: Number(this.config.maxAttachSessions ?? 2),
    })
    this.apple = new AppleProvider({
      subprocess: options.subprocess,
      config: this.config,
      env: this.env,
      home: this.home,
      platform: options.platform,
      logger: this.logger,
    })
    this.contextsCache = undefined
    this.toolsEnabled = false
    this.imageArchCache = new Map()
    this.statusCache = new Map()
    this.valueCache = new Map()
  }

  /** @param {string} method @param {unknown} rawPayload @param {AbortSignal | undefined} signal @param {any} peer */
  async handle(method, rawPayload, signal, peer) {
    try {
      if (peer?.principal?.kind !== 'owner') return fail('docker/forbidden', '只有 DSH owner 会话可以访问本机 Docker')
      const payload = payloadOf(rawPayload)
      const provider = this.providerOf(payload)
      switch (method) {
        case 'ping':
          return ok({
            ok: true,
            plugin: 'dsh-plugin-container',
            version: '0.2.0',
            dockerPath: this.cli.dockerPath ?? null,
            containerPath: this.apple.cli.containerPath ?? null,
          })
        case 'providers':
          return ok(await this.providers(signal))
        case 'buildContext':
          return ok(inspectBuildContext(payload.path))
        case 'status':
        case 'list':
        case 'inspect':
        case 'run':
        case 'action':
        case 'runtimeAction':
          if (provider === 'apple-container') return ok(await this.apple[method](payload, signal))
          if (method === 'action') return ok(await this.action(payload, signal))
          return ok(await this[method](payload, signal))
        case 'attach':
          return ok(await this.attachStart(provider, payload, signal))
        case 'attachPoll':
          return ok(this.attach.poll(payload))
        case 'attachInput':
          return ok(await this.attach.write(payload))
        case 'attachResize':
          return ok(await this.attach.resize(payload))
        case 'attachClose':
          return ok(await this.attach.close(payload))
        case 'poll':
        case 'cancel': {
          const runProvider = this.providerForRun(payload)
          if (runProvider === 'apple-container') return ok(this.apple[method](payload))
          return ok(method === 'poll' ? this.jobs.poll(this.pollInput(payload)) : this.jobs.cancel(requireString(payload.runId, 'runId')))
        }
        default:
          return fail('docker/unknown-method', `未知的 RPC 方法: ${String(method)}`)
      }
    } catch (error) {
      return failureFrom(error)
    }
  }

  /** @param {Record<string, any>} payload */
  providerOf(payload) {
    return payload.provider === 'apple-container' || payload.provider === 'apple' ? 'apple-container' : 'docker'
  }

  /** @param {Record<string, any>} payload */
  providerForRun(payload) {
    const runId = typeof payload.runId === 'string' ? payload.runId : ''
    if (runId.startsWith('apple_')) return 'apple-container'
    if (runId.startsWith('docker_')) return 'docker'
    return this.providerOf(payload)
  }

  enableTools() {
    this.toolsEnabled = true
  }

  /** @param {AbortSignal | undefined} signal */
  async providers(signal) {
    const providers = []
    try {
      const path = await this.cli.ensureDocker({ signal })
      providers.push({ id: 'docker', label: 'Docker', available: true, runtime: 'docker', detail: path })
    } catch (error) {
      providers.push({ id: 'docker', label: 'Docker', available: false, runtime: 'docker', detail: messageOf(error) })
    }
    providers.push(await this.apple.info(signal))
    const defaultProvider = providers.find((provider) => provider.id === 'docker' && provider.available)?.id ?? providers.find((provider) => provider.available)?.id ?? 'docker'
    const features = ['attach', 'exec', 'run', 'image-architecture', 'image-push', 'image-build']
    if (this.toolsEnabled) features.push('ai-tools')
    return { providers, defaultProvider, features }
  }

  /** @param {Record<string, any>} payload */
  pollInput(payload) {
    return {
      runId: requireString(payload.runId, 'runId'),
      stdoutOffset: optionalInteger(payload.stdoutOffset, 'stdoutOffset', { min: 0 }),
      stderrOffset: optionalInteger(payload.stderrOffset, 'stderrOffset', { min: 0 }),
    }
  }

  /** @param {AbortSignal | undefined} signal */
  async loadContexts(signal) {
    const now = Date.now()
    if (this.contextsCache !== undefined && now - this.contextsCache.at < CONTEXT_CACHE_MS) return this.contextsCache.value
    let value = []
    try {
      await this.cli.ensureDocker({ signal })
      const result = await this.cli.docker(['context', 'ls', '--format', 'json'], { context: null, signal, timeoutMs: 10_000 })
      value = parseContexts(result.stdout).contexts
    } catch (error) {
      if (!(error instanceof DockerCliError)) {
        this.logger?.warn?.(`docker status: context discovery failed: ${messageOf(error)}`)
      }
      value = []
    }
    this.contextsCache = { at: now, value }
    return value
  }

  /**
   * @param {string | undefined} requested
   * @param {AbortSignal | undefined} signal
   * @param {{strict?: boolean}} [options]
   */
  async resolveContext(requested, signal, options = {}) {
    const contexts = await this.loadContexts(signal)
    const known = new Set(contexts.map((context) => context.name))
    let name
    try {
      name = normalizeContext(requested, { known })
    } catch (error) {
      if (options.strict === false) name = null
      else throw error
    }
    const selected = name === null ? contexts.find((context) => context.current) ?? contexts[0] ?? null : contexts.find((context) => context.name === name) ?? null
    if (name !== null && selected === null) throw new CommandError(`未知的 Docker context: ${name}`, 'docker/context-unknown')
    return {
      contexts,
      current: contexts.find((context) => context.current) ?? null,
      selected,
      name: selected?.name ?? null,
    }
  }

  /** @param {unknown} value @param {string} field */
  cacheKey(parts) {
    return parts.map((part) => (part === undefined || part === null ? '' : String(part))).join('\u0000')
  }

  /** @param {string} key @param {() => Promise<any>} produce @param {number} ttl */
  async cached(key, produce, ttl = VALUE_CACHE_MS) {
    const now = Date.now()
    const hit = this.valueCache.get(key)
    if (hit !== undefined && now - hit.at < ttl) return hit.value
    const value = await produce()
    this.valueCache.set(key, { at: now, value })
    return value
  }

  invalidate() {
    this.statusCache.clear()
    this.valueCache.clear()
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async status(payload, signal) {
    const requested = optionalString(payload.context, 'context')
    const cacheKey = this.cacheKey(['status', requested ?? ''])
    const now = Date.now()
    const hit = this.statusCache.get(cacheKey)
    if (hit !== undefined && now - hit.at < STATUS_CACHE_MS) return hit.value

    const contexts = await this.loadContexts(signal)
    const known = new Set(contexts.map((context) => context.name))
    let selectedName = requested ?? null
    if (selectedName !== null && !known.has(selectedName)) selectedName = null
    const current = contexts.find((context) => context.current) ?? null
    const selected = selectedName === null ? current ?? contexts[0] ?? null : contexts.find((context) => context.name === selectedName) ?? null

    let dockerPath = null
    let cliError = null
    try {
      dockerPath = await this.cli.ensureDocker({ signal })
    } catch (error) {
      cliError = error
    }

    let version = null
    let info = null
    let daemonError = null
    let daemonState = 'unknown'
    let versionError = null
    if (dockerPath !== null) {
      try {
        const result = await this.cli.docker(['version', '--format', '{{json .}}'], {
          context: selected?.name ?? null,
          signal,
          timeoutMs: 12_000,
        })
        version = mapDockerVersion(JSON.parse(result.stdout))
        if (version.server !== null) daemonState = 'running'
      } catch (error) {
        versionError = error
        if (error instanceof DockerCommandError) daemonError = error.stderr || error.message
      }
      try {
        const result = await this.cli.docker(['info', '--format', '{{json .}}'], {
          context: selected?.name ?? null,
          signal,
          timeoutMs: 15_000,
        })
        info = mapDockerInfo(JSON.parse(result.stdout))
        daemonState = 'running'
        daemonError = null
      } catch (error) {
        if (daemonError === null) daemonError = error instanceof DockerCommandError ? error.stderr || error.message : messageOf(error)
        if (daemonState !== 'running') {
          daemonState = /cannot connect|is the docker daemon running|no such host|connection refused|permission denied/iu.test(daemonError)
            ? 'stopped'
            : 'unreachable'
        }
      }
    }

    let runtime
    try {
      const resolved = await this.runtime.resolve(contexts, selected?.name ?? requested ?? null, {
        running: daemonState === 'running',
        error: daemonError,
      }, signal)
      runtime = resolved.runtime
    } catch (error) {
      runtime = {
        kind: 'unknown',
        label: 'Docker',
        profile: null,
        installed: null,
        running: daemonState === 'running',
        vmRunning: daemonState === 'running',
        canStart: false,
        canStop: false,
        canRestart: false,
        endpoint: selected?.endpoint ?? '',
        details: null,
        error: messageOf(error),
      }
    }

    const warnings = []
    if (selected?.error) warnings.push(selected.error)
    if (daemonError) warnings.push(firstLine(daemonError))
    if (versionError !== null && daemonState !== 'running') warnings.push(firstLine(messageOf(versionError)))

    const value = {
      provider: 'docker',
      fetchedAt: Date.now(),
      platform: process.platform,
      cli: {
        installed: dockerPath !== null,
        path: dockerPath,
        version: version?.client?.version ?? null,
        error: cliError === null ? null : messageOf(cliError),
      },
      daemon: {
        state: daemonState,
        error: daemonError === null ? null : summarizeStderr(daemonError),
      },
      context: {
        selected: selected?.name ?? null,
        current: current?.name ?? null,
        endpoint: selected?.endpoint ?? '',
        description: selected?.description ?? '',
        contexts,
      },
      client: version?.client ?? info?.client ?? null,
      server: info?.server ?? version?.server ?? null,
      runtime,
      env: {
        dockerHost: typeof this.env.DOCKER_HOST === 'string' && this.env.DOCKER_HOST !== '',
        dockerContext: typeof this.env.DOCKER_CONTEXT === 'string' ? this.env.DOCKER_CONTEXT : null,
      },
      capabilities: {
        enableRuntimeControl: this.runtime.controlEnabled,
        maxOutputBytes: Number(this.config.maxOutputBytes ?? 1024 * 1024),
        defaultTimeoutMs: Number(this.config.defaultTimeoutMs ?? 120_000),
        compose: true,
        contexts: true,
        canCompose: selected !== null,
      },
      warnings,
    }
    this.statusCache.set(cacheKey, { at: now, value })
    return value
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async list(payload, signal) {
    const resource = requireString(payload.resource, 'resource')
    const resolved = await this.resolveContext(optionalString(payload.context, 'context'), signal)
    const context = resolved.name
    const all = payload.all !== false
    const key = this.cacheKey(['list', resource, context ?? '', all ? 'all' : 'running'])
    return this.cached(key, async () => {
      const command = {
        containers: ['ps', ...(all ? ['-a'] : []), '--format', '{{json .}}'],
        images: ['images', '--format', '{{json .}}'],
        volumes: ['volume', 'ls', '--format', '{{json .}}'],
        networks: ['network', 'ls', '--format', '{{json .}}'],
        compose: ['compose', 'ls', '-a', '--format', 'json'],
        disk: ['system', 'df', '--format', '{{json .}}'],
      }[resource]
      if (command === undefined) throw new CommandError(`不支持的资源类型: ${resource}`)
      let result
      try {
        result = await this.cli.docker(command, { context, signal, timeoutMs: resource === 'disk' ? 30_000 : 20_000 })
      } catch (error) {
        if (resource !== 'compose') throw error
        // Older Compose releases reject --format json; retry with the table.
        result = await this.cli.docker(['compose', 'ls', '-a'], { context, signal, timeoutMs: 20_000 })
        const parsed = parseComposeList(result.stdout)
        return { fetchedAt: Date.now(), items: parsed.items, format: parsed.format, warnings: this.warningsOf(result.stderr) }
      }
      let items
      let format = 'json'
      if (resource === 'containers') items = parseNdjson(result.stdout).map(normalizeContainer)
      else if (resource === 'images') {
        items = parseNdjson(result.stdout).map(normalizeImage)
        items = await this.withImageArchitectures(items, context, signal)
      }
      else if (resource === 'volumes') items = parseNdjson(result.stdout).map(normalizeVolume)
      else if (resource === 'networks') items = parseNdjson(result.stdout).map(normalizeNetwork)
      else if (resource === 'disk') items = parseSystemDf(result.stdout)
      else {
        const parsed = parseComposeList(result.stdout)
        items = parsed.items
        format = parsed.format
      }
      return { fetchedAt: Date.now(), items, format, warnings: this.warningsOf(result.stderr) }
    })
  }

  /**
   * `docker images` does not expose image architecture; inspect the listed IDs
   * once and cache the stable platform result.
   * @param {any[]} items
   * @param {string | null} context
   * @param {AbortSignal | undefined} signal
   */
  async withImageArchitectures(items, context, signal) {
    if (items.length === 0) return items
    const now = Date.now()
    const keyFor = (id) => `${context ?? ''}\u0000${id}`
    const missing = []
    for (const item of items) {
      const cached = this.imageArchCache.get(keyFor(item.id))
      if (cached === undefined || now - cached.at > 5 * 60_000) missing.push(item.id)
    }
    if (missing.length > 0) {
      try {
        const result = await this.cli.docker(
          ['image', 'inspect', '--format', '{{json .}}', ...missing.slice(0, 64)],
          { context, signal, timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 },
        )
        const byId = new Map()
        for (const line of result.stdout.split(/\r?\n/u)) {
          if (line.trim() === '') continue
          try {
            const value = JSON.parse(line)
            if (typeof value?.Id !== 'string') continue
            const architecture = [value.Os, value.Architecture, value.Variant].filter(Boolean).join('/')
            byId.set(value.Id, architecture)
            byId.set(value.Id.replace(/^sha256:/u, ''), architecture)
          } catch {
            // Ignore malformed inspect output; architecture is optional metadata.
          }
        }
        for (const id of missing) {
          const full = [...byId.keys()].find((candidate) => candidate === id || candidate.startsWith(id) || id.startsWith(candidate))
          const value = full === undefined ? '' : byId.get(full)
          this.imageArchCache.set(keyFor(id), { at: now, value: value ?? '' })
        }
      } catch {
        for (const id of missing) this.imageArchCache.set(keyFor(id), { at: 0, value: '' })
      }
    }
    return items.map((item) => {
      const cached = this.imageArchCache.get(keyFor(item.id))
      return { ...item, architecture: cached?.value ?? '' }
    })
  }

  /** @param {string} stderr */
  warningsOf(stderr) {
    const line = firstLine(stderr)
    return line === '' ? [] : [line]
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async inspect(payload, signal) {
    const kind = requireString(payload.kind, 'kind')
    if (!['container', 'image', 'volume', 'network'].includes(kind)) throw new CommandError('不支持的 inspect 类型')
    const id = safeIdentifier(payload.id)
    const resolved = await this.resolveContext(optionalString(payload.context, 'context'), signal)
    const result = await this.cli.docker([kind, 'inspect', id], {
      context: resolved.name,
      signal,
      timeoutMs: 20_000,
      maxBytes: 4 * 1024 * 1024,
    })
    try {
      const parsed = JSON.parse(result.stdout)
      const value = Array.isArray(parsed) ? parsed[0] ?? null : parsed
      return { value, raw: result.stdout, warnings: this.warningsOf(result.stderr) }
    } catch (error) {
      return { value: null, raw: result.stdout, parseError: messageOf(error), warnings: this.warningsOf(result.stderr) }
    }
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async run(payload, signal) {
    const dockerPath = await this.cli.ensureDocker({ signal })
    const resolved = await this.resolveContext(optionalString(payload.context, 'context'), signal)
    let subargv
    if (payload.argv !== undefined) {
      if (payload.command !== undefined) throw new CommandError('command 和 argv 只能提供一个')
      subargv = normalizeSubcommand(payload.argv, { dockerPath })
    } else {
      subargv = parseCommand(requireString(payload.command, 'command'), { dockerPath })
    }
    const context = resolved.name
    const cwd = resolveCwd(payload.cwd, { fallback: this.home, statSync })
    const displayCommand = describeCommand(subargv, context)
    const destructive = detectDestructive(subargv)
    if (destructive.dangerous && payload.confirm !== true) {
      throw Object.assign(new Error(`危险操作需要确认: ${displayCommand}`), {
        code: 'docker/confirmation-required',
        details: { command: displayCommand, reason: destructive.reason },
      })
    }
    const timeoutMs = optionalInteger(payload.timeoutMs, 'timeoutMs', { min: 5000, max: 30 * 60_000 }) ?? Number(this.config.defaultTimeoutMs ?? 120_000)
    const argv = this.cli.argvFor(subargv, { context })
    const run = this.jobs.start({
      argv,
      displayCommand,
      context,
      cwd,
      title: optionalString(payload.title, 'title') ?? '',
      timeoutMs,
    })
    this.invalidate()
    return { run }
  }

  /**
   * Start an interactive attach PTY. Docker attaches PID 1; Apple container has
   * no attach verb, so it opens an exec shell in the running container.
   * @param {'docker' | 'apple-container'} provider
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async attachStart(provider, payload, signal) {
    const id = safeIdentifier(payload.id)
    const name = optionalString(payload.name, 'name') ?? id
    const mode = payload.mode === 'exec' ? 'exec' : 'attach'
    const cols = optionalInteger(payload.cols, 'cols', { min: 20, max: 300 }) ?? 120
    const rows = optionalInteger(payload.rows, 'rows', { min: 5, max: 120 }) ?? 30
    if (provider === 'apple-container') {
      const path = await this.apple.cli.ensureContainer({ signal })
      let running = false
      try {
        const raw = await this.apple.cli.json(['list', '-a', '--format', 'json'], { signal, timeoutMs: 15_000 })
        const found = (Array.isArray(raw) ? raw : []).find((entry) => entry?.id === id || entry?.configuration?.id === id)
        running = found?.status?.state === 'running'
      } catch (error) {
        throw new CommandError(`无法读取 Apple container 状态: ${messageOf(error)}`, 'container/exec-failed')
      }
      if (!running) throw new CommandError(`容器未运行，无法 ${mode}`, 'container/not-running')
      const argv = [path, 'exec', '-i', '-t', id, '/bin/sh']
      return {
        session: await this.attach.start({
          argv,
          cwd: this.home,
          env: this.apple.cli.childEnv(),
          provider,
          containerId: id,
          containerName: name,
          command: `container exec -i -t ${id} /bin/sh`,
          mode,
          cols,
          rows,
          signal,
        }),
      }
    }
    await this.cli.ensureDocker({ signal })
    const resolved = await this.resolveContext(optionalString(payload.context, 'context'), signal)
    const context = resolved.name
    const running = await this.cli.docker(['inspect', '--format', '{{.State.Running}}', id], {
      context,
      signal,
      timeoutMs: 15_000,
    })
    if (running.stdout.trim() !== 'true') throw new CommandError(`容器未运行，无法 ${mode}`, 'docker/not-running')
    const subargv = mode === 'exec' ? ['exec', '-i', '-t', id, '/bin/sh'] : ['attach', id]
    return {
      session: await this.attach.start({
        argv: this.cli.argvFor(subargv, { context }),
        cwd: this.home,
        env: this.cli.childEnv(),
        provider: 'docker',
        containerId: id,
        containerName: name,
        command: describeCommand(subargv, context),
        mode,
        cols,
        rows,
        signal,
      }),
    }
  }

  /**
   * Semantic quick action for Docker; provider-specific syntax is centralized here.
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async action(payload, signal) {
    const kind = requireString(payload.kind, 'kind')
    const action = requireString(payload.action, 'action')
    if (kind === 'container' && action === 'run') {
      const image = safeImageRef(payload.image)
      const name = optionalString(payload.name, 'name')
      if (name !== undefined) safeIdentifier(name)
      const args = parseArguments(optionalString(payload.command, 'command') ?? '')
      const ports = stringList(payload.ports, 'ports').map(safePort)
      const env = stringList(payload.env, 'env').map(safeEnv)
      const argv = [
        'run',
        '-d',
        '-i',
        '-t',
        ...(name === undefined ? [] : ['--name', name]),
        ...ports.flatMap((port) => ['-p', port]),
        ...env.flatMap((entry) => ['-e', entry]),
        image,
        ...args,
      ]
      return this.run({
        argv,
        context: payload.context,
        cwd: payload.cwd,
        title: payload.title ?? `启动容器 ${image}`,
      }, signal)
    }
    if (kind === 'image' && action === 'build') {
      const spec = buildSpec(payload)
      return this.run({
        argv: buildArgv(spec),
        context: payload.context,
        cwd: spec.contextDir,
        timeoutMs: LONG_JOB_MS,
        title: payload.title ?? `构建镜像 ${spec.tag}`,
      }, signal)
    }
    if (kind === 'image' && action === 'push') {
      const { source, target } = pushSpec(payload)
      if (target !== source) {
        await this.cli.ensureDocker({ signal })
        const resolved = await this.resolveContext(optionalString(payload.context, 'context'), signal)
        await this.cli.docker(['tag', source, target], { context: resolved.name, signal, timeoutMs: 20_000 })
      }
      return this.run({
        argv: ['push', target],
        context: payload.context,
        cwd: payload.cwd,
        timeoutMs: LONG_JOB_MS,
        title: payload.title ?? `推送镜像 ${target}`,
      }, signal)
    }
    const id = safeIdentifier(payload.id ?? payload.reference)
    let argv
    if (kind === 'container') {
      if (action === 'start') argv = ['start', id]
      else if (action === 'stop') argv = ['stop', id]
      else if (action === 'restart') argv = ['restart', id]
      else if (action === 'delete') argv = ['rm', '-f', id]
      else if (action === 'logs') argv = ['logs', '--tail', payload.follow === true ? '100' : '500', ...(payload.follow === true ? ['-f'] : []), id]
    } else if (kind === 'image') {
      if (action === 'pull') {
        const platform = platformOf(payload.platform)
        argv = ['pull', ...(platform === undefined ? [] : ['--platform', platform]), id]
      }
      else if (action === 'delete') argv = ['rmi', id]
    } else if (kind === 'volume' && action === 'delete') {
      argv = ['volume', 'rm', id]
    } else if (kind === 'network' && action === 'delete') {
      argv = ['network', 'rm', id]
    }
    if (argv === undefined) throw new CommandError(`不支持的操作: ${kind}/${action}`)
    return this.run({
      argv,
      context: payload.context,
      cwd: payload.cwd,
      confirm: payload.confirm,
      timeoutMs: payload.timeoutMs,
      title: payload.title ?? `${kind} ${action} ${id}`,
    }, signal)
  }

  /**
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async runtimeAction(payload, signal) {
    const action = requireString(payload.action, 'action')
    if (!['start', 'stop', 'restart'].includes(action)) throw new CommandError('不支持的运行时操作')
    if ((action === 'stop' || action === 'restart') && payload.confirm !== true) {
      throw Object.assign(new Error(`停止/重启 Docker 运行时需要确认`), {
        code: 'docker/confirmation-required',
        details: { command: action === 'stop' ? '停止运行时' : '重启运行时', reason: 'runtime-stop' },
      })
    }
    const status = await this.status({ context: payload.context }, signal)
    const spec = this.runtime.actionSpec(action, status.runtime)
    const run = this.jobs.start({
      argv: spec.argv,
      displayCommand: spec.displayCommand,
      context: null,
      cwd: this.home,
      title: spec.title,
      timeoutMs: spec.timeoutMs,
    })
    this.invalidate()
    return { run, dispatched: true, message: spec.title }
  }

  /**
   * Read container logs for a tool (not exposed as a UI RPC).
   * @param {Record<string, any>} payload
   * @param {AbortSignal | undefined} signal
   */
  async logs(payload, signal) {
    const provider = payload.provider === 'apple-container' ? 'apple-container' : 'docker'
    const id = safeIdentifier(payload.id)
    const tail = optionalInteger(payload.tail ?? 200, 'tail', { min: 1, max: 500 })
    const maxBytes = 256 * 1024
    if (provider === 'apple-container') {
      const path = await this.apple.cli.ensureContainer({ signal })
      const result = await this.apple.cli.exec(['logs', '-n', String(tail), id], { signal, cwd: this.home, timeoutMs: 20_000, maxBytes })
      const text = `${result.stdout}${result.stderr}`
      if (result.timedOut) throw new CommandError('读取 Apple container 日志超时', 'container/timeout')
      if (result.exitCode !== 0) {
        throw Object.assign(new CommandError(text.trim() || `container logs 退出码 ${String(result.exitCode)}`, 'container/exec-failed'), { stderr: result.stderr })
      }
      return { provider, id, tail, text }
    }
    await this.cli.ensureDocker({ signal })
    const resolved = await this.resolveContext(optionalString(payload.context, 'context'), signal)
    const result = await this.cli.docker(['logs', '--tail', String(tail), id], {
      context: resolved.name,
      signal,
      timeoutMs: 20_000,
      maxBytes,
    })
    return { provider, id, tail, text: `${result.stdout}${result.stderr}` }
  }

  dispose() {
    this.jobs.dispose()
    this.attach.dispose().catch(() => {})
    this.apple.dispose()
    this.statusCache.clear()
    this.valueCache.clear()
    this.imageArchCache.clear()
  }
}

export function createDockerService(options) {
  return new DockerService(options)
}
