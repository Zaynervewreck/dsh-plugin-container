/** Browser-local view state: active tab, selected context, console cwd. */
import { defineStore } from '@deepseek-ai/dsh-client-store'

const TAB_KEY = 'dsh.docker.tab'
const CONTEXT_KEY = 'dsh.docker.context'
const CWD_KEY = 'dsh.docker.cwd'
const PROVIDER_KEY = 'dsh.docker.provider'
const HISTORY_KEY = 'dsh.docker.history'
const VALID_TABS = new Set(['overview', 'containers', 'images', 'volumes', 'networks', 'compose', 'console'])
const VALID_PROVIDERS = new Set(['docker', 'apple-container'])

/** @param {string} key */
function read(key) {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

/** @param {string} key @param {string | null} value */
function write(key, value) {
  try {
    if (typeof localStorage === 'undefined') return
    if (value === null || value === '') localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable in private contexts; view state still works.
  }
}

export function readHistory() {
  try {
    const raw = read(HISTORY_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === 'string').slice(0, 50) : []
  } catch {
    return []
  }
}

/** @param {string[]} entries */
export function writeHistory(entries) {
  try {
    write(HISTORY_KEY, JSON.stringify(entries.slice(0, 50)))
  } catch {
    // ignore
  }
}

export function createDockerStore() {
  return defineStore({
    init: () => {
      const storedTab = read(TAB_KEY)
      const storedContext = read(CONTEXT_KEY)
      const storedCwd = read(CWD_KEY)
      const storedProvider = read(PROVIDER_KEY)
      return {
        provider: storedProvider !== null && VALID_PROVIDERS.has(storedProvider) ? storedProvider : 'docker',
        tab: storedTab !== null && VALID_TABS.has(storedTab) ? storedTab : 'overview',
        context: storedContext !== null && storedContext !== '' ? storedContext : null,
        cwd: storedCwd ?? '',
      }
    },
    actions: {
      /** @param {{provider: string}} draft @param {string} provider */
      setProvider(draft, provider) {
        if (!VALID_PROVIDERS.has(provider)) return
        draft.provider = provider
        write(PROVIDER_KEY, provider)
      },
      /** @param {{tab: string}} draft @param {string} tab */
      setTab(draft, tab) {
        if (!VALID_TABS.has(tab)) return
        draft.tab = tab
        write(TAB_KEY, tab)
      },
      /** @param {{context: string | null}} draft @param {string | null} context */
      setContext(draft, context) {
        draft.context = context === '' ? null : context
        write(CONTEXT_KEY, draft.context)
      },
      /** @param {{cwd: string}} draft @param {string} cwd */
      setCwd(draft, cwd) {
        draft.cwd = cwd
        write(CWD_KEY, cwd)
      },
    },
  })
}
