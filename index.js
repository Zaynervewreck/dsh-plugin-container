/**
 * Host entry for the Docker sidebar plugin.
 *
 * This file is loaded by the DSH Loader from an absolute path, so it imports
 * only local modules and Node built-ins. The browser half is served separately
 * from `lib/client.js` through the package's `dsh.client` declaration.
 *
 * The browser calls the same `/docker/...` envelope used by the Connection
 * generic RPC channel. We mount the route ourselves because Connection's
 * `rpc.handle` helper registers on the service owner's context, which does not
 * inject `webServer`; the direct route below reuses `connection.admit()` for
 * the same Host/Origin fence and browser authentication.
 */
import { createDockerService } from './src/host/service.js'
import { registerContainerTools } from './src/host/tools.js'

export const name = 'docker-sidebar'
export const inject = ['subprocess', 'connection', 'webServer', 'tools', 'systemPrompt']

const CHANNEL = '/docker'
const MAX_BODY_BYTES = 1024 * 1024

/** @param {import('node:http').IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.byteLength
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** @param {import('node:http').ServerResponse} res @param {number} status @param {unknown} body */
function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  if (res.writableEnded) return
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  res.end(text)
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {any} ctx
 * @param {ReturnType<typeof createDockerService>} service
 */
async function handleRequest(req, res, ctx, service) {
  let admission
  try {
    admission = ctx.connection.admit(req)
  } catch (error) {
    send(res, 403, `forbidden: ${error instanceof Error ? error.message : String(error)}`, 'text/plain; charset=utf-8')
    return
  }
  if ('rejection' in admission) {
    send(res, admission.rejection, admission.rejection === 401 ? 'unauthorized' : 'forbidden', 'text/plain; charset=utf-8')
    return
  }
  if (req.method !== 'POST') {
    send(res, 405, 'method not allowed', 'text/plain; charset=utf-8')
    return
  }
  const url = new URL(req.url ?? CHANNEL, 'http://dsh.internal')
  const endpoint = url.pathname.startsWith(`${CHANNEL}/`) ? url.pathname.slice(CHANNEL.length + 1) : ''
  if (endpoint === '' || endpoint.includes('/')) {
    send(res, 404, 'not found', 'text/plain; charset=utf-8')
    return
  }

  let message
  try {
    message = JSON.parse(await readBody(req))
  } catch (error) {
    send(res, 400, `invalid request body: ${error instanceof Error ? error.message : String(error)}`, 'text/plain; charset=utf-8')
    return
  }
  if (
    message === null ||
    typeof message !== 'object' ||
    message.type !== 'client-request' ||
    typeof message.rpcId !== 'string' ||
    typeof message.method !== 'string' ||
    message.method !== endpoint
  ) {
    send(res, 400, 'invalid client-request envelope', 'text/plain; charset=utf-8')
    return
  }

  const controller = new AbortController()
  const abort = () => controller.abort()
  res.on('close', abort)
  try {
    const result = await service.handle(message.method, message.payload, controller.signal, admission.peer)
    send(res, 200, { type: 'server-response', rpcId: message.rpcId, result })
  } catch (error) {
    send(res, 500, `handler failure: ${error instanceof Error ? error.message : String(error)}`, 'text/plain; charset=utf-8')
  } finally {
    res.off('close', abort)
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, any>} [config]
 */
export function apply(ctx, config = {}) {
  const service = createDockerService({
    subprocess: ctx.subprocess,
    logger: ctx.logger,
    config: config ?? {},
  })
  try {
    registerContainerTools(ctx, service)
    service.enableTools()
  } catch (error) {
    ctx.logger?.warn?.('docker: container tool registration failed', error)
  }
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: CHANNEL,
      handler: (req, res) => handleRequest(req, res, ctx, service).catch((error) => {
        send(res, 500, `handler failure: ${error instanceof Error ? error.message : String(error)}`, 'text/plain; charset=utf-8')
      }),
    }),
    'docker: rpc route',
  )
  ctx.effect(() => () => service.dispose(), 'docker: jobs')
}
