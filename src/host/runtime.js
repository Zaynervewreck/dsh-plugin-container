/**
 * macOS Docker runtime discovery and lifecycle actions.
 *
 * The runtime is inferred from the selected Docker context endpoint plus the
 * local application/CLI inventory. Nothing here mutates Docker configuration:
 * commands use `--context`, and colima/Docker Desktop actions are explicit
 * user choices from the panel.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { classifyEndpoint, parseColimaList, parseColimaStatus } from './parsers.js'
import { messageOf } from './util.js'

const DOCKER_APP_CANDIDATES = ['/Applications/Docker.app', join(homedir(), 'Applications/Docker.app')]
const ORB_APP_CANDIDATES = ['/Applications/OrbStack.app', join(homedir(), 'Applications/OrbStack.app')]

/** @param {string[]} paths @param {(path: string) => boolean} exists */
function firstExisting(paths, exists) {
  return paths.find((path) => exists(path)) ?? null
}

/**
 * @param {{
 *   cli: import('./docker-cli.js').DockerCli,
 *   platform?: NodeJS.Platform,
 *   env?: NodeJS.ProcessEnv,
 *   fs?: { existsSync: (path: string) => boolean },
 *   config?: Record<string, any>,
 * }} options
 */
export function createRuntimeResolver(options) {
  const cli = options.cli
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const fs = options.fs ?? { existsSync }
  const config = options.config ?? {}
  const controlEnabled = platform === 'darwin' && config.enableRuntimeControl !== false

  /** @param {AbortSignal | undefined} signal */
  async function inventory(signal) {
    const dockerDesktop = firstExisting(DOCKER_APP_CANDIDATES, fs.existsSync)
    const orbStack = firstExisting(ORB_APP_CANDIDATES, fs.existsSync)
    const colimaPath = platform === 'darwin' ? await cli.ensureColima({ signal }) : null
    let colimaInstances = []
    let colimaError
    if (colimaPath !== null) {
      try {
        const result = await cli.program(colimaPath, ['list', '--json'], { signal, timeoutMs: 15_000, maxBytes: 128 * 1024 })
        colimaInstances = parseColimaList(result.stdout)
      } catch (error) {
        colimaError = messageOf(error)
      }
    }
    return { dockerDesktop, orbStack, colimaPath, colimaInstances, colimaError }
  }

  /**
   * @param {Array<{name:string,description:string,endpoint:string,current:boolean,error:string}>} contexts
   * @param {string | null | undefined} requested
   */
  function selectContext(contexts, requested) {
    const current = contexts.find((context) => context.current) ?? null
    const selected = (requested ? contexts.find((context) => context.name === requested) : undefined) ?? current ?? contexts[0] ?? null
    return { current, selected, requested: requested ?? null }
  }

  /**
   * @param {Awaited<ReturnType<typeof inventory>>} found
   * @param {{name:string, endpoint:string} | null} context
   * @param {{running?: boolean, error?: string}} daemon
   */
  function describe(found, context, daemon = {}) {
    const endpointClass = classifyEndpoint(context?.endpoint)
    const daemonRunning = daemon.running === true
    if (endpointClass.kind === 'colima') {
      const profile = endpointClass.profile ?? 'default'
      const instance =
        found.colimaInstances.find((item) => item.name === profile) ??
        found.colimaInstances.find((item) => (context?.name ?? '').endsWith(profile)) ??
        null
      const vmRunning = instance !== null ? /running/iu.test(instance.status) : daemonRunning
      return {
        kind: 'colima',
        label: 'colima',
        profile,
        installed: found.colimaPath !== null,
        running: daemonRunning,
        vmRunning,
        canStart: controlEnabled && found.colimaPath !== null && !daemonRunning,
        canStop: controlEnabled && found.colimaPath !== null && (daemonRunning || vmRunning),
        canRestart: controlEnabled && found.colimaPath !== null && (daemonRunning || vmRunning) && vmRunning,
        endpoint: context?.endpoint ?? '',
        details: instance,
        error: found.colimaError ?? daemon.error ?? null,
      }
    }
    if (endpointClass.kind === 'orbstack') {
      return {
        kind: 'orbstack',
        label: 'OrbStack',
        profile: null,
        installed: found.orbStack !== null,
        running: daemonRunning,
        vmRunning: daemonRunning,
        canStart: controlEnabled && found.orbStack !== null && !daemonRunning,
        canStop: controlEnabled && found.orbStack !== null && daemonRunning,
        canRestart: false,
        endpoint: context?.endpoint ?? '',
        details: found.orbStack !== null ? { appPath: found.orbStack } : null,
        error: daemon.error ?? null,
      }
    }
    if (endpointClass.kind === 'local-socket') {
      if (found.dockerDesktop !== null) {
        return {
          kind: 'docker-desktop',
          label: 'Docker Desktop',
          profile: null,
          installed: true,
          running: daemonRunning,
          vmRunning: daemonRunning,
          canStart: controlEnabled && !daemonRunning,
          canStop: controlEnabled && daemonRunning,
          canRestart: false,
          endpoint: context?.endpoint ?? '',
          details: { appPath: found.dockerDesktop },
          error: daemon.error ?? null,
        }
      }
      return {
        kind: 'unknown',
        label: 'Docker',
        profile: null,
        installed: null,
        running: daemonRunning,
        vmRunning: daemonRunning,
        canStart: false,
        canStop: false,
        canRestart: false,
        endpoint: context?.endpoint ?? '',
        details: null,
        error: daemon.error ?? null,
      }
    }
    if (endpointClass.kind === 'remote') {
      return {
        kind: 'remote',
        label: '远程 Docker',
        profile: null,
        installed: null,
        running: daemonRunning,
        vmRunning: daemonRunning,
        canStart: false,
        canStop: false,
        canRestart: false,
        endpoint: context?.endpoint ?? '',
        details: null,
        error: daemon.error ?? null,
      }
    }
    return {
      kind: 'unknown',
      label: 'Docker',
      profile: null,
      installed: null,
      running: daemonRunning,
      vmRunning: daemonRunning,
      canStart: false,
      canStop: false,
      canRestart: false,
      endpoint: context?.endpoint ?? '',
      details: null,
      error: daemon.error ?? null,
    }
  }

  /**
   * @param {Array<{name:string,description:string,endpoint:string,current:boolean,error:string}>} contexts
   * @param {string | null | undefined} requested
   * @param {{running?: boolean, error?: string}} daemon
   * @param {AbortSignal | undefined} signal
   */
  async function resolve(contexts, requested, daemon, signal) {
    const found = await inventory(signal)
    const selected = selectContext(contexts, requested)
    const runtime = describe(found, selected.selected, daemon)
    if (runtime.kind === 'colima' && runtime.profile !== null && runtime.installed) {
      try {
        const result = await cli.program(found.colimaPath, ['status', '--json', '--profile', runtime.profile], {
          signal,
          timeoutMs: 15_000,
          maxBytes: 256 * 1024,
        })
        const status = parseColimaStatus(result.stdout)
        if (status !== null) {
          runtime.details = { ...(runtime.details ?? {}), ...status }
          runtime.vmRunning = true
          runtime.canStop = controlEnabled
          runtime.canRestart = controlEnabled
          runtime.cpus = status.cpus
          runtime.memory = status.memory
          runtime.disk = status.disk
          runtime.driver = status.driver
          runtime.arch = status.arch
          runtime.mountType = status.mountType
          runtime.dockerSocket = status.dockerSocket
          runtime.kubernetes = status.kubernetes
        }
      } catch (error) {
        // Stopped colima instances cannot report status; the list already
        // carries the state, so this is not an error worth surfacing.
        if (runtime.vmRunning) runtime.error = runtime.error ?? messageOf(error)
      }
    }
    return { ...selected, runtime }
  }

  /**
   * Build one explicit runtime action. The caller decides confirmation and
   * whether to run it as a job.
   * @param {string} action
   * @param {ReturnType<typeof describe>} runtime
   */
  function actionSpec(action, runtime) {
    if (!controlEnabled) throw Object.assign(new Error('当前平台或配置不允许控制 Docker 运行时'), { code: 'docker/unsupported' })
    if (action !== 'start' && action !== 'stop' && action !== 'restart') {
      throw Object.assign(new Error(`不支持的运行时操作: ${action}`), { code: 'docker/unsupported' })
    }
    if (runtime.kind === 'colima') {
      if (!runtime.installed) throw Object.assign(new Error('未找到 colima CLI'), { code: 'docker/cli-missing' })
      if (action === 'restart' && !runtime.canRestart) {
        throw Object.assign(new Error('当前 colima 未运行，无需重启'), { code: 'docker/unsupported' })
      }
      const colimaPath = cli.colimaPath
      if (colimaPath === undefined || colimaPath === null) throw Object.assign(new Error('未找到 colima CLI'), { code: 'docker/cli-missing' })
      const profile = runtime.profile ?? 'default'
      return {
        argv: [colimaPath, action, '--profile', profile],
        title: `colima ${action}`,
        displayCommand: `colima ${action} --profile ${profile}`,
        timeoutMs: 10 * 60_000,
      }
    }
    if (runtime.kind === 'docker-desktop') {
      if (action === 'restart') throw Object.assign(new Error('Docker Desktop 暂不支持一键重启，请先停止再启动'), { code: 'docker/unsupported' })
      if (action === 'start') {
        const app = runtime.details?.appPath ?? 'Docker'
        return {
          argv: ['/usr/bin/open', '-a', app],
          title: '启动 Docker Desktop',
          displayCommand: `open -a ${app}`,
          timeoutMs: 30_000,
        }
      }
      return {
        argv: ['/usr/bin/osascript', '-e', 'tell application id "com.docker.docker" to quit'],
        title: '停止 Docker Desktop',
        displayCommand: 'osascript -e \'tell application id "com.docker.docker" to quit\'',
        timeoutMs: 120_000,
      }
    }
    if (runtime.kind === 'orbstack') {
      if (action === 'restart') throw Object.assign(new Error('OrbStack 暂不支持一键重启'), { code: 'docker/unsupported' })
      const app = runtime.details?.appPath ?? 'OrbStack'
      return action === 'start'
        ? {
            argv: ['/usr/bin/open', '-a', app],
            title: '启动 OrbStack',
            displayCommand: `open -a ${app}`,
            timeoutMs: 30_000,
          }
        : {
            argv: ['/usr/bin/osascript', '-e', 'tell application "OrbStack" to quit'],
            title: '停止 OrbStack',
            displayCommand: 'osascript -e \'tell application "OrbStack" to quit\'',
            timeoutMs: 120_000,
          }
    }
    throw Object.assign(new Error('当前 Docker 上下文没有可本机控制的运行时'), { code: 'docker/unsupported' })
  }

  return { inventory, selectContext, resolve, actionSpec, controlEnabled, platform, env }
}
