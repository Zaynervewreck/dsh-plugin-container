/** Tolerant parsers for Docker, colima, and Apple container CLI output. */
import { formatBytes } from './util.js'

/** @param {unknown} value */
function textOf(value) {
  return value === undefined || value === null ? '' : String(value)
}

/** @param {string} text @returns {any[]} */
export function parseNdjson(text) {
  const items = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const value = JSON.parse(trimmed)
      if (Array.isArray(value)) items.push(...value)
      else items.push(value)
    } catch (error) {
      throw new Error(`无法解析 JSON 行: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return items
}

/**
 * Parse a whole JSON document, an NDJSON stream, or a JSON array.
 * @param {string} text
 * @returns {any}
 */
export function parseJsonLoose(text) {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    const rows = parseNdjson(trimmed)
    return rows.length === 1 ? rows[0] : rows
  }
}

/** @param {string} text */
export function firstLine(text) {
  const line = text.split(/\r?\n/u).find((value) => value.trim() !== '')
  return line === undefined ? '' : line.trim()
}

/** @param {string} text @param {number} [max] */
export function summarizeStderr(text, max = 2048) {
  if (typeof text !== 'string' || text === '') return ''
  if (text.length <= max) return text
  return `…[truncated]\n${text.slice(-max)}`
}

/** @param {unknown} value */
export function parseLabels(value) {
  if (typeof value !== 'string' || value.trim() === '') return {}
  const labels = {}
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=')
    if (separator <= 0) continue
    labels[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim()
  }
  return labels
}

/** @param {unknown} value */
function portList(value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  return value.split(',').map((port) => port.trim()).filter(Boolean)
}

/** @param {Record<string, any>} raw */
export function normalizeContainer(raw) {
  const names = textOf(raw.Names).split(',').map((name) => name.trim()).filter(Boolean)
  return {
    id: textOf(raw.ID),
    name: names[0] ?? textOf(raw.Names),
    names,
    image: textOf(raw.Image),
    command: textOf(raw.Command),
    createdAt: textOf(raw.CreatedAt),
    runningFor: textOf(raw.RunningFor),
    ports: portList(raw.Ports),
    status: textOf(raw.Status),
    state: textOf(raw.State).toLowerCase() || 'unknown',
    size: textOf(raw.Size),
    labels: parseLabels(raw.Labels),
    mounts: textOf(raw.Mounts),
    networks: textOf(raw.Networks),
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeImage(raw) {
  const repository = textOf(raw.Repository)
  const tag = textOf(raw.Tag)
  return {
    id: textOf(raw.ID),
    repository,
    tag,
    name: repository === '<none>' && tag === '<none>' ? '<none>' : `${repository}${tag ? `:${tag}` : ''}`,
    createdAt: textOf(raw.CreatedAt),
    createdSince: textOf(raw.CreatedSince),
    size: textOf(raw.Size),
    sharedSize: textOf(raw.SharedSize),
    uniqueSize: textOf(raw.UniqueSize),
    containers: textOf(raw.Containers),
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeVolume(raw) {
  return {
    name: textOf(raw.Name),
    driver: textOf(raw.Driver),
    scope: textOf(raw.Scope),
    mountpoint: textOf(raw.Mountpoint),
    labels: parseLabels(raw.Labels),
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeNetwork(raw) {
  return {
    id: textOf(raw.ID),
    name: textOf(raw.Name),
    driver: textOf(raw.Driver),
    scope: textOf(raw.Scope),
    ipv4: textOf(raw.IPv4),
    ipv6: textOf(raw.IPv6),
    internal: textOf(raw.Internal),
    createdAt: textOf(raw.CreatedAt),
    labels: parseLabels(raw.Labels),
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeCompose(raw) {
  return {
    name: textOf(raw.Name ?? raw.name),
    status: textOf(raw.Status ?? raw.status),
    configFiles: textOf(raw.ConfigFiles ?? raw.configFiles),
    raw,
  }
}

/**
 * @param {string} text
 * @returns {{items: any[], format: 'json'|'text'}}
 */
export function parseComposeList(text) {
  try {
    const value = JSON.parse(text.trim())
    if (Array.isArray(value)) return { items: value.map(normalizeCompose), format: 'json' }
    if (value !== null && typeof value === 'object') return { items: [normalizeCompose(value)], format: 'json' }
  } catch {
    // Older Compose releases have no --format json; fall through to the table.
  }
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return { items: [], format: 'text' }
  const header = lines[0]
  if (!/^NAME\b/iu.test(header)) return { items: [], format: 'text' }
  const items = []
  for (const line of lines.slice(1)) {
    const columns = line.split(/\s{2,}/u)
    if (columns.length < 2) continue
    items.push(normalizeCompose({ Name: columns[0], Status: columns[1], ConfigFiles: columns.slice(2).join('  ') }))
  }
  return { items, format: 'text' }
}

/**
 * @param {string} text
 * @returns {{contexts: Array<{name:string,description:string,endpoint:string,current:boolean,error:string}>}}
 */
export function parseContexts(text) {
  const rows = parseNdjson(text)
  return {
    contexts: rows
      .filter((row) => row !== null && typeof row === 'object')
      .map((row) => ({
        name: textOf(row.Name),
        description: textOf(row.Description),
        endpoint: textOf(row.DockerEndpoint),
        current: row.Current === true,
        error: textOf(row.Error),
      }))
      .filter((row) => row.name !== ''),
  }
}

/** @param {Record<string, any>} raw */
export function mapDockerVersion(raw) {
  const client = raw.Client !== null && typeof raw.Client === 'object' ? raw.Client : null
  const server = raw.Server !== null && typeof raw.Server === 'object' ? raw.Server : null
  return {
    client:
      client === null
        ? null
        : {
            version: textOf(client.Version),
            apiVersion: textOf(client.ApiVersion),
            context: textOf(client.Context),
            os: textOf(client.Os),
            arch: textOf(client.Arch),
            gitCommit: textOf(client.GitCommit),
            goVersion: textOf(client.GoVersion),
          },
    server:
      server === null
        ? null
        : {
            version: textOf(server.Version),
            apiVersion: textOf(server.ApiVersion),
            os: textOf(server.Os),
            arch: textOf(server.Arch),
            kernelVersion: textOf(server.KernelVersion),
            gitCommit: textOf(server.GitCommit),
            goVersion: textOf(server.GoVersion),
          },
  }
}

/** @param {Record<string, any>} raw */
export function mapDockerInfo(raw) {
  const client = raw.ClientInfo !== null && typeof raw.ClientInfo === 'object' ? raw.ClientInfo : null
  return {
    server: {
      name: textOf(raw.Name),
      version: textOf(raw.ServerVersion),
      osType: textOf(raw.OSType),
      operatingSystem: textOf(raw.OperatingSystem),
      architecture: textOf(raw.Architecture),
      kernelVersion: textOf(raw.KernelVersion),
      driver: textOf(raw.Driver),
      dockerRootDir: textOf(raw.DockerRootDir),
      ncpu: Number(raw.NCPU) || 0,
      memTotal: Number(raw.MemTotal) || 0,
      containers: Number(raw.Containers) || 0,
      containersRunning: Number(raw.ContainersRunning) || 0,
      containersPaused: Number(raw.ContainersPaused) || 0,
      containersStopped: Number(raw.ContainersStopped) || 0,
      images: Number(raw.Images) || 0,
      warnings: Array.isArray(raw.Warnings) ? raw.Warnings.map(String) : [],
    },
    client:
      client === null
        ? null
        : {
            version: textOf(client.Version),
            apiVersion: textOf(client.DefaultAPIVersion),
            os: textOf(client.Platform?.Name),
            arch: textOf(client.Arch),
            context: textOf(client.Context),
          },
    raw,
  }
}

/** @param {string} text */
export function parseColimaList(text) {
  const rows = parseNdjson(text)
  return rows.map((row) => ({
    name: textOf(row.name),
    status: textOf(row.status),
    arch: textOf(row.arch),
    cpus: Number(row.cpus) || 0,
    memory: Number(row.memory) || 0,
    disk: Number(row.disk) || 0,
    runtime: textOf(row.runtime),
    raw: row,
  }))
}

/** @param {string} text */
export function parseColimaStatus(text) {
  const value = parseJsonLoose(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return {
    displayName: textOf(value.display_name),
    driver: textOf(value.driver),
    arch: textOf(value.arch),
    runtime: textOf(value.runtime),
    mountType: textOf(value.mount_type),
    ipAddress: textOf(value.ip_address),
    dockerSocket: textOf(value.docker_socket),
    kubernetes: value.kubernetes === true,
    cpus: Number(value.cpu) || 0,
    memory: Number(value.memory) || 0,
    disk: Number(value.disk) || 0,
    raw: value,
  }
}

/**
 * Classify a Docker endpoint without deciding whether a local app exists.
 * @param {string | null | undefined} endpoint
 * @returns {{kind:'colima'|'orbstack'|'local-socket'|'remote'|'unknown', profile?:string}}
 */
export function classifyEndpoint(endpoint) {
  const value = textOf(endpoint)
  if (value === '') return { kind: 'unknown' }
  const colima = /\.colima\/([^/]+)\/docker\.sock/iu.exec(value)
  if (colima !== null) return { kind: 'colima', profile: colima[1] }
  if (/colima/iu.test(value)) return { kind: 'colima', profile: 'default' }
  if (/orbstack/iu.test(value)) return { kind: 'orbstack' }
  if (/^(?:tcp|ssh|http|https):\/\//iu.test(value)) return { kind: 'remote' }
  if (/^(?:unix|npipe):/iu.test(value)) return { kind: 'local-socket' }
  return { kind: 'unknown' }
}

/** @param {string} text */
export function parseSystemDf(text) {
  return parseNdjson(text).map((row) => ({
    type: textOf(row.Type),
    totalCount: Number(row.TotalCount) || 0,
    activeCount: Number(row.ActiveCount) || 0,
    size: textOf(row.Size),
    reclaimable: textOf(row.Reclaimable),
    raw: row,
  }))
}

/** @param {string} text */
export function parseAppleJson(text) {
  const value = JSON.parse(text.trim())
  return value
}

/** @param {Record<string, any>} raw */
function applePort(value) {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  const host = textOf(value.hostAddress ?? value.address ?? value.host ?? '0.0.0.0')
  const hostPort = textOf(value.hostPort ?? value.host_port ?? '')
  const containerPort = textOf(value.containerPort ?? value.container_port ?? value.targetPort ?? '')
  const protocol = textOf(value.protocol ?? 'tcp')
  if (containerPort === '') return ''
  return `${host}${hostPort === '' ? '' : `:${hostPort}`}->${containerPort}/${protocol}`
}

/** @param {Record<string, any>} raw */
export function normalizeAppleContainer(raw) {
  const config = raw.configuration !== null && typeof raw.configuration === 'object' ? raw.configuration : {}
  const status = raw.status !== null && typeof raw.status === 'object' ? raw.status : {}
  const init = config.initProcess !== null && typeof config.initProcess === 'object' ? config.initProcess : {}
  const args = Array.isArray(init.arguments) ? init.arguments.map(String) : []
  const networks = Array.isArray(config.networks)
    ? config.networks.map((entry) => textOf(entry?.network ?? entry?.name ?? entry)).filter(Boolean)
    : []
  const mounts = Array.isArray(config.mounts) ? config.mounts : []
  return {
    id: textOf(config.id ?? raw.id),
    name: textOf(config.id ?? raw.id),
    names: [textOf(config.id ?? raw.id)].filter(Boolean),
    image: textOf(config.image?.reference ?? config.image?.descriptor?.digest),
    command: [textOf(init.executable), ...args].filter(Boolean).join(' '),
    createdAt: textOf(config.creationDate),
    runningFor: textOf(status.startedDate),
    ports: (Array.isArray(config.publishedPorts) ? config.publishedPorts : []).map(applePort).filter(Boolean),
    status: textOf(status.state),
    state: textOf(status.state).toLowerCase() || 'unknown',
    size: '',
    labels: config.labels !== null && typeof config.labels === 'object' ? config.labels : {},
    mounts,
    networks: networks.join(','),
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeAppleImage(raw) {
  const config = raw.configuration !== null && typeof raw.configuration === 'object' ? raw.configuration : {}
  const reference = textOf(config.name ?? raw.id)
  const lastSlash = reference.lastIndexOf('/')
  const lastColon = reference.lastIndexOf(':')
  const hasTag = lastColon > lastSlash
  const repository = hasTag ? reference.slice(0, lastColon) : reference
  const tag = hasTag ? reference.slice(lastColon + 1) : ''
  const variants = Array.isArray(raw.variants) ? raw.variants : []
  const size = variants.reduce((sum, variant) => sum + (Number(variant?.size) || 0), 0)
  const architectures = []
  for (const variant of variants) {
    const platform = variant?.platform ?? {
      os: variant?.config?.os,
      architecture: variant?.config?.architecture,
      variant: variant?.config?.variant,
    }
    const parts = [platform?.os, platform?.architecture, platform?.variant].filter(Boolean)
    if (parts.length >= 2) architectures.push(parts.join('/'))
  }
  return {
    id: textOf(raw.id ?? config.descriptor?.digest),
    repository,
    tag,
    name: reference,
    createdAt: textOf(config.creationDate),
    createdSince: textOf(config.creationDate),
    size: size > 0 ? formatBytes(size) : '',
    sharedSize: '',
    uniqueSize: '',
    containers: '',
    architecture: [...new Set(architectures)].join(', '),
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeAppleVolume(raw) {
  const config = raw.configuration !== null && typeof raw.configuration === 'object' ? raw.configuration : {}
  return {
    name: textOf(config.name ?? raw.id),
    driver: textOf(config.driver),
    scope: 'local',
    mountpoint: textOf(config.source),
    labels: config.labels !== null && typeof config.labels === 'object' ? config.labels : {},
    createdAt: textOf(config.creationDate),
    size: Number(config.sizeInBytes) || 0,
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function normalizeAppleNetwork(raw) {
  const config = raw.configuration !== null && typeof raw.configuration === 'object' ? raw.configuration : {}
  const status = raw.status !== null && typeof raw.status === 'object' ? raw.status : {}
  return {
    id: textOf(config.name ?? raw.id),
    name: textOf(config.name ?? raw.id),
    driver: textOf(config.plugin ?? config.mode),
    scope: 'local',
    ipv4: textOf(status.ipv4Subnet),
    ipv6: textOf(status.ipv6Subnet),
    internal: textOf(config.mode),
    createdAt: textOf(config.creationDate),
    labels: config.labels !== null && typeof config.labels === 'object' ? config.labels : {},
    raw,
  }
}

/** @param {Record<string, any>} raw */
export function parseAppleSystemStatus(raw) {
  return {
    status: textOf(raw?.status),
    apiServerVersion: textOf(raw?.apiServerVersion),
    apiServerBuild: textOf(raw?.apiServerBuild),
    apiServerCommit: textOf(raw?.apiServerCommit),
    appRoot: textOf(raw?.appRoot),
    installRoot: textOf(raw?.installRoot),
    raw,
  }
}

/** @param {any[]} raw */
export function parseAppleSystemVersion(raw) {
  const rows = Array.isArray(raw) ? raw : raw === null || typeof raw !== 'object' ? [] : [raw]
  const component = (name) => rows.find((row) => textOf(row?.appName) === name)
  return {
    containerVersion: textOf(component('container')?.version),
    apiServerVersion: textOf(component('container-apiserver')?.version),
    components: rows,
  }
}

/** @param {Record<string, any>} raw */
export function parseAppleDf(raw) {
  const item = (key, type) => {
    const value = raw?.[key] !== null && typeof raw?.[key] === 'object' ? raw[key] : {}
    return {
      type,
      totalCount: Number(value.total) || 0,
      activeCount: Number(value.active) || 0,
      size: formatBytes(Number(value.sizeInBytes) || 0),
      reclaimable: formatBytes(Number(value.reclaimable) || 0),
      raw: value,
    }
  }
  return [item('images', 'Images'), item('containers', 'Containers'), item('volumes', 'Local Volumes')]
}
