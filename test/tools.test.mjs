import assert from 'node:assert/strict'
import { test } from 'node:test'

import { registerContainerTools } from '../src/host/tools.js'

function fakeContext() {
  const tools = new Map()
  const sections = []
  return {
    tools: { register(definition) { tools.set(definition.name, definition) } },
    systemPrompt: { section(value) { sections.push(value) } },
    toolsMap: tools,
    sections,
  }
}

function fakeService() {
  return {
    async handle(method, payload) {
      if (method === 'status') return { ok: true, value: { provider: payload.provider, daemon: { state: 'running' }, warnings: [] } }
      if (method === 'list') return { ok: true, value: { items: [{ name: 'web' }], warnings: [] } }
      if (method === 'inspect') return { ok: true, value: { value: { Config: { Env: ['PASSWORD=secret', 'PATH=/bin'] } }, warnings: [] } }
      throw new Error(`unexpected ${method}`)
    },
    async logs(payload) { return { provider: payload.provider, id: payload.id, tail: payload.tail, text: 'log line\n' } },
  }
}

test('registers four read-only container tools and a system prompt section', async () => {
  const ctx = fakeContext()
  registerContainerTools(ctx, fakeService())
  assert.deepEqual([...ctx.toolsMap.keys()].sort(), ['container_inspect', 'container_list', 'container_logs', 'container_status'])
  assert.equal(ctx.sections.length, 1)
  assert.match(ctx.sections[0].text, /read-only/iu)
})

test('container tools return compact facts and redact sensitive env values', async () => {
  const ctx = fakeContext()
  const service = fakeService()
  registerContainerTools(ctx, service)
  const list = await ctx.toolsMap.get('container_list').execute({ provider: 'docker', resource: 'containers' }, { signal: undefined })
  assert.equal(list.provider, 'docker')
  assert.equal(list.items[0].name, 'web')

  const inspect = await ctx.toolsMap.get('container_inspect').execute({ provider: 'apple-container', kind: 'container', id: 'web' }, { signal: undefined })
  const rendered = inspect.inspect
  assert.equal(rendered.Config.Env[0], 'PASSWORD=[redacted]')
  assert.equal(rendered.Config.Env[1], 'PATH=/bin')

  const logs = await ctx.toolsMap.get('container_logs').execute({ provider: 'docker', id: 'web', tail: 25 }, { signal: undefined })
  assert.equal(logs.tail, 25)
  assert.equal(logs.text, 'log line\n')
})
