/** Shared helpers for the Docker sidebar host half. */

export const MAX_COMMAND_BYTES = 8 * 1024
export const MAX_ARGV = 128
export const MAX_ARG_BYTES = 4096

/** @param {unknown} value */
export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** @param {unknown} value @param {string} field */
export function requireString(value, field, { max = MAX_ARG_BYTES, allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string`)
  if (!allowEmpty && value.length === 0) throw new TypeError(`${field} must not be empty`)
  if (value.includes('\0')) throw new TypeError(`${field} must not contain NUL`)
  if (Buffer.byteLength(value, 'utf8') > max) throw new TypeError(`${field} is too long`)
  return value
}

/** @param {unknown} value @param {string} field @param {{min?: number, max?: number}} range */
export function optionalInteger(value, field, range) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${field} must be a number`)
  const integer = Math.trunc(value)
  const min = range.min ?? Number.MIN_SAFE_INTEGER
  const max = range.max ?? Number.MAX_SAFE_INTEGER
  if (integer < min || integer > max) throw new RangeError(`${field} must be between ${min} and ${max}`)
  return integer
}

/** @param {unknown} value */
export function booleanOrFalse(value) {
  return value === true
}

/** @param {string} text @param {number} max */
export function truncateText(text, max) {
  if (text.length <= max) return { text, truncated: false }
  return { text: `…[truncated ${text.length - max} chars]\n${text.slice(-max)}`, truncated: true }
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${index === 0 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`
}

/** @param {string} arg */
export function quoteArg(arg) {
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/u.test(arg)) return arg
  return `'${arg.replaceAll("'", "'\\''")}'`
}

/** @param {string[]} argv @param {string | null} context @param {string} [commandName] */
export function displayCommand(argv, context, commandName = 'docker') {
  const parts = [commandName]
  if (context) parts.push('--context', context)
  parts.push(...argv)
  return parts.map(quoteArg).join(' ')
}

/** @param {unknown} error */
export function messageOf(error) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** @param {unknown} error */
export function codeOf(error) {
  return isRecord(error) && typeof error.code === 'string' ? error.code : undefined
}

/** @param {string} text */
export function stripAnsi(text) {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

/** @param {number} ms */
export function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}
