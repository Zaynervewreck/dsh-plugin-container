/** Client entry: register locale, main panel, and the left-sidebar Docker entry. */
import { createApi } from './api.js'
import { DockerMark } from './icons.jsx'
import { NS, en, zh } from './i18n.js'
import DockerPage from './page.jsx'
import { RunController } from './runs.js'
import { createDockerStore } from './store.js'
import { injectStyles } from './styles.js'

injectStyles()

export const inject = ['slots', 'layout', 'locale', 'connection', 'sessions']

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'docker: dictionaries')
  const t = ctx.locale.bind(NS)
  const api = createApi(ctx.connection)
  const runs = new RunController(api)
  const startDiagnosis = async (text) => {
    const list = ctx.sessions.list.getSnapshot()
    const current = Object.values(list.byId ?? {}).find((session) => (session.retainedBy?.mainView ?? 0) > 0)
    if (current === undefined || typeof current.cwd !== 'string' || current.cwd === '') throw new Error('当前没有可用工作区，无法创建诊断会话')
    const request = { cwd: current.cwd }
    const preset = current.projectionValues?.agentPreset
    if (typeof preset === 'string' && preset !== '') request.agentPreset = preset
    const sessionId = await ctx.sessions.create(request)
    // A Session binding is materialized when the main view retains it.
    ctx.get('uiWorkspace')?.openSession?.(sessionId)
    let binding = ctx.sessions.binding(sessionId)
    for (let attempt = 0; attempt < 40 && binding === undefined; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      binding = ctx.sessions.binding(sessionId)
    }
    if (binding === undefined) throw new Error('新诊断会话尚未就绪')
    const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(`发送到诊断会话失败: ${result.error?.message ?? 'unknown'}`)
    return sessionId
  }

  // Desktop exposes the OS chooser directly; other peers go through the workspace UI.
  const pickDirectory = async () => {
    const desktop = globalThis.__DSH_DIRECTORY_PICKER__
    if (desktop !== undefined && typeof desktop.pick === 'function') return desktop.pick()
    const workspace = ctx.get('uiWorkspace')
    if (typeof workspace?.pickDirectory === 'function') return workspace.pickDirectory()
    throw new Error('unsupported')
  }
  const canPickDirectory = () => (
    (globalThis.__DSH_DIRECTORY_PICKER__ !== undefined && typeof globalThis.__DSH_DIRECTORY_PICKER__.pick === 'function') ||
    typeof ctx.get('uiWorkspace')?.pickDirectory === 'function'
  )
  pickDirectory.available = canPickDirectory

  const handle = createDockerStore()
  const instance = handle.create()
  const store = { ...handle, create: () => instance }

  ctx.effect(() => () => runs.dispose(), 'docker: runs')

  ctx.slots.inject('main', function* registerMain() {
    yield ctx.slots.register(
      {
        name: 'main',
        key: 'docker',
        locale: NS,
        store,
        inject: () => ({ api, runs, startDiagnosis, pickDirectory }),
      },
      DockerPage,
    )
  })

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: 'docker',
        order: 20,
        locale: NS,
        label: () => t('panel'),
      },
      DockerIcon,
    ),
  )
}

function DockerIcon({ size = 18 }) {
  return <DockerMark size={size} />
}
