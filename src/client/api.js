/** Typed wrapper around the host `/docker` Connection RPC channel. */

export const DOCKER_CHANNEL = '/docker'

export class DockerApiError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [details]
   * @param {unknown} [cause]
   */
  constructor(code, message, details = {}, cause = undefined) {
    super(message)
    this.name = 'DockerApiError'
    this.code = code
    this.details = details
    this.cause = cause
  }
}

/** @param {unknown} error */
export function isAbortError(error) {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    error?.name === 'AbortError' ||
    error?.code === 'docker/cancelled'
  )
}

/** @param {unknown} value */
function isResult(value) {
  return typeof value === 'object' && value !== null && typeof value.ok === 'boolean'
}

/** @param {any} connection */
export function createApi(connection) {
  return {
    connection,
    /**
     * @param {string} method
     * @param {Record<string, any>} payload
     * @param {AbortSignal} [signal]
     */
    async call(method, payload = {}, signal = undefined) {
      let result
      try {
        result = await connection.rpc.call(DOCKER_CHANNEL, method, payload, signal)
      } catch (error) {
        if (isAbortError(error)) throw new DockerApiError('docker/cancelled', '请求已取消', {}, error)
        throw new DockerApiError('docker/transport', transportMessage(error), {}, error)
      }
      if (!isResult(result)) throw new DockerApiError('docker/protocol', 'Docker 服务返回了无效响应')
      if (result.ok !== true) {
        const error = result.error ?? {}
        throw new DockerApiError(
          typeof error.code === 'string' ? error.code : 'docker/internal',
          typeof error.message === 'string' ? error.message : 'Docker 服务调用失败',
          error.details ?? {},
        )
      }
      return result.value
    },
  }
}

/** @param {unknown} error */
function transportMessage(error) {
  const message = error instanceof Error ? error.message : String(error)
  if (/HTTP 404|not found/iu.test(message)) return 'Docker 服务未加载（/docker 通道不可用），请刷新页面或重启 DSH'
  if (/HTTP 500/iu.test(message)) return 'Docker 服务内部错误，请查看 DSH 日志'
  if (/HTTP 401|HTTP 403/iu.test(message)) return '没有权限访问本机 Docker 服务'
  return `Docker 服务连接失败：${message}`
}

/** Module-level query cache used by the tabs. Values only, never promises. */
const queryCache = new Map()

/** @param {string} key */
export function cacheGet(key) {
  const hit = queryCache.get(key)
  if (hit === undefined) return undefined
  if (Date.now() - hit.at > hit.ttl) {
    queryCache.delete(key)
    return undefined
  }
  return hit.value
}

/** @param {string} key @param {unknown} value @param {number} [ttl] */
export function cacheSet(key, value, ttl = 2000) {
  queryCache.set(key, { at: Date.now(), value, ttl })
}

/** @param {string} [prefix] */
export function cacheClear(prefix = '') {
  if (prefix === '') queryCache.clear()
  else for (const key of [...queryCache.keys()]) if (key.startsWith(prefix)) queryCache.delete(key)
}
