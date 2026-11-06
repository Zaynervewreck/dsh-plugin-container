/**
 * Docker command parsing and safety policy.
 *
 * Commands are never handed to a shell. The tokenizer only splits argv, and
 * shell operators are rejected so a pasted `docker ps | grep x` fails loudly
 * instead of silently becoming arguments to Docker.
 */
import { basename, isAbsolute } from 'node:path'

import {
  MAX_ARG_BYTES,
  MAX_ARGV,
  MAX_COMMAND_BYTES,
  displayCommand,
  messageOf,
  requireString,
} from './util.js'

const SHELL_OPERATORS = new Set(['|', '&', ';', '<', '>', '(', ')', '`', '$'])
const FORBIDDEN_GLOBAL_FLAGS = new Set(['--context', '--host', '--config'])
const FORBIDDEN_GLOBAL_PREFIXES = ['--tls', '-H']
const DESTRUCTIVE_FIRST = new Set(['rm', 'rmi', 'prune', 'kill', 'stop', 'delete'])
const DESTRUCTIVE_GROUPS = new Set(['volume', 'network', 'container', 'image', 'builder'])
const SENSITIVE_MARKERS = new Set(['login', 'logout', '--password', '--password-stdin', '--token', '--registry-token'])

export class CommandError extends Error {
  /** @param {string} message @param {string} [code] */
  constructor(message, code = 'docker/invalid-command') {
    super(message)
    this.name = 'CommandError'
    this.code = code
  }
}

/** @param {string} input */
function tokenize(input) {
  if (Buffer.byteLength(input, 'utf8') > MAX_COMMAND_BYTES) throw new CommandError('命令太长（上限 8 KiB）')
  if (input.includes('\0')) throw new CommandError('命令包含非法 NUL 字符')

  const tokens = []
  let current = ''
  let quote = null
  let hasToken = false
  let index = 0

  const push = () => {
    if (!hasToken) return
    tokens.push(current)
    current = ''
    hasToken = false
    if (tokens.length > MAX_ARGV) throw new CommandError(`参数过多（上限 ${MAX_ARGV} 项）`)
  }

  while (index < input.length) {
    const char = input[index]
    if (quote === "'") {
      if (char === "'") quote = null
      else current += char
      hasToken = true
      index += 1
      continue
    }
    if (quote === '"') {
      if (char === '"') {
        quote = null
        index += 1
        continue
      }
      if (char === '\\') {
        const next = input[index + 1]
        if (next === undefined) throw new CommandError('命令以未完成的转义结尾')
        current += next
        hasToken = true
        index += 2
        continue
      }
      current += char
      hasToken = true
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      hasToken = true
      index += 1
      continue
    }
    if (char === '\\') {
      const next = input[index + 1]
      if (next === undefined) throw new CommandError('命令以未完成的转义结尾')
      current += next
      hasToken = true
      index += 2
      continue
    }
    if (SHELL_OPERATORS.has(char)) {
      throw new CommandError('不支持管道、重定向、命令替换等 shell 语法；请分开执行，或改用快捷操作')
    }
    if (/\s/u.test(char)) {
      push()
      index += 1
      continue
    }
    current += char
    hasToken = true
    index += 1
  }
  if (quote !== null) throw new CommandError('引号没有闭合')
  push()
  for (const token of tokens) {
    if (Buffer.byteLength(token, 'utf8') > MAX_ARG_BYTES) throw new CommandError('单个参数太长（上限 4 KiB）')
  }
  return tokens
}

/**
 * Parse free-form command text into a Docker subcommand argv.
 * @param {string} input
 * @param {{dockerPath?: string}} [options]
 */
export function parseCommand(input, options = {}) {
  const text = requireString(input, 'command', { max: MAX_COMMAND_BYTES, allowEmpty: true })
  const tokens = tokenize(text.trim())
  return normalizeSubcommand(tokens, options)
}

/**
 * Parse shell-free argument text without stripping a leading command name.
 * Used by structured actions such as `run <image> <args>`.
 * @param {string} input
 * @returns {string[]}
 */
export function parseArguments(input) {
  const text = requireString(input, 'arguments', { max: MAX_COMMAND_BYTES, allowEmpty: true })
  return tokenize(text.trim())
}

/**
 * Normalize both free-form and structured input to the argv after `docker`.
 * @param {unknown} value
 * @param {{dockerPath?: string}} [options]
 */
export function normalizeSubcommand(value, options = {}) {
  const commandName = options.commandName ?? 'docker'
  if (!Array.isArray(value)) throw new CommandError('argv 必须是字符串数组')
  if (value.length === 0) throw new CommandError(`请输入 ${commandName} 命令`)
  if (value.length > MAX_ARGV) throw new CommandError(`参数过多（上限 ${MAX_ARGV} 项）`)
  const tokens = value.map((token, index) => requireString(token, `argv[${index}]`))
  let argv = tokens
  const binaryName = options.dockerPath ? basename(options.dockerPath) : commandName
  if (argv[0] === commandName || argv[0] === binaryName || argv[0] === options.dockerPath) argv = argv.slice(1)
  if (argv.length === 0) throw new CommandError(`请输入 ${commandName} 子命令`)
  if (argv[0] === 'sudo' || argv[0] === 'env') throw new CommandError(`只能执行 ${commandName} 子命令，不能执行其他程序`)
  if (commandName === 'container' && argv[0] === 'docker') throw new CommandError('当前 provider 是 Apple container，请使用 container 命令')
  for (const token of argv) {
    if (FORBIDDEN_GLOBAL_FLAGS.has(token) || token.startsWith('--context=') || token.startsWith('--host=') || token.startsWith('--config=')) {
      throw new CommandError(`不允许在命令中覆盖 ${token}；请使用面板的上下文选择器`)
    }
    if (FORBIDDEN_GLOBAL_PREFIXES.some((prefix) => token === prefix || token.startsWith(`${prefix}=`) || (prefix === '-H' && token.startsWith('-H') && token.length > 2))) {
      throw new CommandError(`不允许在命令中覆盖 ${token}；连接目标由上下文决定`)
    }
  }
  return argv
}

/**
 * @param {string | undefined | null} context
 * @param {{known?: Set<string>}} [options]
 * @returns {string | null}
 */
export function normalizeContext(context, options = {}) {
  if (context === undefined || context === null || context === '') return null
  if (typeof context !== 'string') throw new CommandError('context 必须是字符串')
  if (!/^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$/u.test(context)) throw new CommandError('context 名称不合法')
  if (options.known !== undefined && !options.known.has(context)) throw new CommandError(`未知的 Docker context: ${context}`, 'docker/context-unknown')
  return context
}

/**
 * @param {string[]} argv
 * @returns {{dangerous: boolean, reason: string | null}}
 */
export function detectDestructive(argv) {
  const first = argv[0]
  const second = argv[1]
  if (DESTRUCTIVE_FIRST.has(first)) {
    if (first === 'stop' || first === 'kill') return { dangerous: true, reason: 'stop' }
    if (first === 'rm' || first === 'rmi' || first === 'delete') return { dangerous: true, reason: 'delete' }
    return { dangerous: true, reason: 'prune' }
  }
  if (first === 'compose' && (second === 'down' || second === 'rm')) return { dangerous: true, reason: 'compose-down' }
  if (first === 'system' && second === 'prune') return { dangerous: true, reason: 'prune' }
  if (DESTRUCTIVE_GROUPS.has(first) && (second === 'rm' || second === 'delete' || second === 'prune')) {
    return { dangerous: true, reason: second === 'prune' ? 'prune' : 'delete' }
  }
  if (first === 'swarm' && second === 'leave') return { dangerous: true, reason: 'delete' }
  return { dangerous: false, reason: null }
}

/**
 * @param {string[]} argv
 * @returns {boolean}
 */
export function isSensitiveCommand(argv) {
  return argv.some((token) => SENSITIVE_MARKERS.has(token) || token.startsWith('--password=') || token.startsWith('--token='))
}

/**
 * Resolve a client-provided cwd to an absolute existing directory.
 * @param {unknown} value
 * @param {{fallback: string, statSync: (path: string) => {isDirectory: () => boolean}}} options
 */
export function resolveCwd(value, options) {
  if (value === undefined || value === null || value === '') return options.fallback
  if (typeof value !== 'string') throw new CommandError('cwd 必须是字符串', 'docker/invalid-cwd')
  if (!isAbsolute(value)) throw new CommandError('cwd 必须是绝对路径', 'docker/invalid-cwd')
  if (value.includes('\0') || value.length > 4096) throw new CommandError('cwd 不合法', 'docker/invalid-cwd')
  let stat
  try {
    stat = options.statSync(value)
  } catch (error) {
    throw new CommandError(`cwd 不存在或不可访问: ${messageOf(error)}`, 'docker/invalid-cwd')
  }
  if (!stat.isDirectory()) throw new CommandError('cwd 不是目录', 'docker/invalid-cwd')
  return value
}

/**
 * Build the client-facing display form without resolving the binary path.
 * @param {string[]} argv
 * @param {string | null} context
 */
export function describeCommand(argv, context, commandName = 'docker') {
  return displayCommand(argv, context, commandName)
}
