import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import vm from 'node:vm'

function fakeReact() {
  class Component {
    constructor(props) { this.props = props }
    setState() {}
  }
  const context = (value) => ({ _currentValue: value, Provider: function Provider() {}, Consumer: function Consumer() {} })
  return {
    Component,
    createContext: context,
    useContext: (ctx) => ctx?._currentValue,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  }
}

test('built client bundle registers the main panel and sidebar entry', async () => {
  const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  let registration
  const styles = []
  const document = {
    head: { appendChild: (node) => styles.push(node) },
    body: { appendChild: () => {} },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, style: {}, set textContent(value) { this._text = value }, get textContent() { return this._text } }),
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  }
  const react = fakeReact()
  const store = {
    defineStore: (config) => ({
      create: () => ({ getSnapshot: () => config.init(), subscribe: () => () => {} }),
      actions: config.actions,
    }),
  }
  const reactDom = { createPortal: (node) => node }
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    document,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    navigator: { clipboard: undefined },
    DOMException: class DOMException extends Error {},
    require: (specifier) => {
      if (specifier === 'react') return react
      if (specifier === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' }
      if (specifier === 'react-dom') return reactDom
      if (specifier === '@deepseek-ai/dsh-client-store') return store
      throw new Error(`unexpected require ${specifier}`)
    },
  }
  sandbox.window = sandbox
  sandbox.globalThis = sandbox
  sandbox.window.__ModuleLoader__ = {
    load: (value) => { registration = value },
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.equal(registration.id, 'dsh-plugin-container')
  const exports = registration.factory(sandbox.require)
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(Array.from(exports.inject), ['slots', 'layout', 'locale', 'connection', 'sessions'])

  const registered = []
  const fakeCtx = {
    connection: { rpc: { call: async () => ({ ok: true, value: {} }) } },
    effect: (factory) => {
      const disposer = factory()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    locale: {
      register: () => () => {},
      bind: () => (key) => key,
    },
    slots: {
      inject: (_name, callback) => {
        const result = callback()
        if (result !== null && typeof result === 'object' && typeof result[Symbol.iterator] === 'function') {
          for (const _ of result) { /* drain */ }
        }
        return () => {}
      },
      register: (options, component) => {
        registered.push({ options, component })
        return () => {}
      },
    },
  }
  exports.apply(fakeCtx)
  assert.equal(styles.length, 1)
  assert.equal(styles[0].dataset.pluginCss, 'dsh-plugin-container/styles.css')
  assert.ok(registered.some((entry) => entry.options.name === 'main' && entry.options.key === 'docker'))
  assert.ok(registered.some((entry) => entry.options.name === 'sidebar.panellist' && entry.options.id === 'docker'))
})
