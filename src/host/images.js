/**
 * Shared validation for image push and build, used by the Docker and Apple
 * providers. Everything here produces argv arrays; nothing touches a shell.
 */
import { readdirSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'

import { CommandError } from './commands.js'
import { requireString } from './util.js'

const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/u
const PLATFORM = /^[a-z0-9]+\/[a-z0-9]+(?:\/[a-z0-9]+)?$/u
const BUILD_ARG = /^[A-Za-z_][A-Za-z0-9_]*=[^\r\n]*$/u
const DOCKERFILE_NAME = /^(?:Dockerfile|Containerfile)(?:\..+)?$|\.(?:Dockerfile|Containerfile)$/u

export const LONG_JOB_MS = 30 * 60_000

/** @param {unknown} value @param {string} field */
export function imageRef(value, field) {
  const reference = requireString(value, field, { max: 512 })
  if (!IMAGE_REF.test(reference)) throw new CommandError(`镜像名不合法: ${reference}`)
  return reference
}

/**
 * Docker rejects uppercase in the repository part; say so before running.
 * @param {string} reference
 */
function assertLowercaseRepository(reference) {
  const withoutDigest = reference.split('@')[0]
  const lastSlash = withoutDigest.lastIndexOf('/')
  const lastColon = withoutDigest.lastIndexOf(':')
  const repository = lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest
  if (/[A-Z]/u.test(repository)) throw new CommandError(`镜像名的仓库部分必须是小写: ${repository}`)
}

/**
 * Optional `--platform` value shared by pull and build.
 * @param {unknown} value
 * @returns {string | undefined}
 */
export function platformOf(value) {
  if (value === undefined || value === null || String(value).trim() === '') return undefined
  const platform = String(value).trim()
  if (!PLATFORM.test(platform)) throw new CommandError(`平台格式不合法: ${platform}（示例 linux/arm64）`)
  return platform
}

/** @param {Record<string, any>} payload */
export function pushSpec(payload) {
  const source = imageRef(payload.id ?? payload.reference, 'id')
  const target = payload.target === undefined || payload.target === null || String(payload.target).trim() === ''
    ? source
    : imageRef(String(payload.target).trim(), 'target')
  assertLowercaseRepository(target)
  return { source, target }
}

/** @param {unknown} value @param {string} field */
function list(value, field) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new CommandError(`${field} 必须是字符串数组`)
  if (value.length > 64) throw new CommandError(`${field} 数量过多`)
  return value.map((entry, index) => requireString(entry, `${field}[${String(index)}]`, { max: 1024 }))
}

/** @param {unknown} value */
function statOrNull(value) {
  try {
    return statSync(value)
  } catch {
    return null
  }
}

/** @param {Record<string, any>} payload */
export function buildSpec(payload) {
  const tag = imageRef(payload.tag, 'tag')
  assertLowercaseRepository(tag)
  const contextDir = requireString(payload.contextDir, 'contextDir', { max: 4096 })
  if (!isAbsolute(contextDir) || contextDir.includes('\0')) throw new CommandError('构建目录必须是绝对路径')
  const dirStat = statOrNull(contextDir)
  if (dirStat === null) throw new CommandError(`构建目录不存在: ${contextDir}`)
  if (!dirStat.isDirectory()) throw new CommandError(`不是目录: ${contextDir}`)

  let file
  if (payload.file !== undefined && payload.file !== null && String(payload.file).trim() !== '') {
    const name = requireString(String(payload.file).trim(), 'file', { max: 1024 })
    const resolved = resolve(contextDir, name)
    if (resolved !== contextDir && !resolved.startsWith(`${contextDir}${sep}`)) throw new CommandError('Dockerfile 必须位于构建目录内')
    const fileStat = statOrNull(resolved)
    if (fileStat === null || !fileStat.isFile()) throw new CommandError(`找不到 Dockerfile: ${name}`)
    file = resolved
  } else if (statOrNull(join(contextDir, 'Dockerfile')) === null && statOrNull(join(contextDir, 'Containerfile')) === null) {
    throw new CommandError('构建目录里没有 Dockerfile 或 Containerfile，请选择其他目录或指定文件')
  }

  const platform = platformOf(payload.platform)
  const buildArgs = list(payload.buildArgs, 'buildArgs').map((entry) => {
    if (!BUILD_ARG.test(entry)) throw new CommandError(`构建参数格式不合法: ${entry}（示例 KEY=VALUE）`)
    return entry
  })
  return { tag, contextDir, file, platform, noCache: payload.noCache === true, buildArgs }
}

/** Both `docker build` and `container build` accept this flag set. */
export function buildArgv(spec) {
  return [
    'build',
    '-t',
    spec.tag,
    ...(spec.file === undefined ? [] : ['-f', spec.file]),
    ...(spec.platform === undefined ? [] : ['--platform', spec.platform]),
    ...(spec.noCache ? ['--no-cache'] : []),
    ...spec.buildArgs.flatMap((entry) => ['--build-arg', entry]),
    spec.contextDir,
  ]
}

/**
 * Describe a candidate build directory so the form can validate before running.
 * @param {unknown} value
 */
export function inspectBuildContext(value) {
  const path = typeof value === 'string' ? value.trim() : ''
  const empty = { path, exists: false, isDirectory: false, dockerfiles: [], suggestedTag: '' }
  if (path === '' || !isAbsolute(path) || path.includes('\0') || path.length > 4096) return empty
  const stat = statOrNull(path)
  if (stat === null) return empty
  if (!stat.isDirectory()) return { ...empty, exists: true }
  let names = []
  try {
    names = readdirSync(path).filter((name) => DOCKERFILE_NAME.test(name) && statOrNull(join(path, name))?.isFile())
  } catch {
    names = []
  }
  names.sort((a, b) => Number(b === 'Dockerfile') - Number(a === 'Dockerfile') || a.localeCompare(b))
  const slug = basename(path).toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gu, '')
  return { path, exists: true, isDirectory: true, dockerfiles: names.slice(0, 20), suggestedTag: slug === '' ? '' : `${slug}:latest` }
}
