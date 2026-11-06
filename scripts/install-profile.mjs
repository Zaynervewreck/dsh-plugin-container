#!/usr/bin/env node
/**
 * Install or remove this local plugin's Loader row in a DSH profile patch.
 *
 * The row names `index.js` by absolute path. App-boot converts that path to a
 * file URL, and the client-modules scanner reads the nearest package.json, so
 * no profile dependency, symlink, or pnpm install is needed.
 *
 * Usage:
 *   node scripts/install-profile.mjs
 *   node scripts/install-profile.mjs --profile desktop --home ~/.dsh
 *   node scripts/install-profile.mjs --home /tmp/dsh-test --profile test
 *   node scripts/install-profile.mjs --remove
 *   node scripts/install-profile.mjs --dry-run
 */
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BEGIN = '# >>> dsh-plugin-container >>>'
const END = '# <<< dsh-plugin-container <<<'

function parseArgs(argv) {
  const options = {
    home: process.env.DSH_HOME || join(process.env.HOME || '', '.dsh'),
    profile: 'desktop',
    remove: false,
    dryRun: false,
    pluginRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--remove') options.remove = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--home' || arg === '--profile' || arg === '--plugin-root') {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      index += 1
      if (arg === '--home') options.home = value
      else if (arg === '--profile') options.profile = value
      else options.pluginRoot = resolve(value)
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/install-profile.mjs [--home <DSH_HOME>] [--profile <name>] [--plugin-root <dir>] [--remove] [--dry-run]')
      process.exit(0)
    } else {
      throw new Error(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  options.home = resolve(options.home.replace(/^~(?=\/|$)/u, process.env.HOME || '~'))
  options.pluginRoot = resolve(options.pluginRoot)
  return options
}

function blockFor(pluginRoot) {
  const entry = join(pluginRoot, 'index.js')
  return [
    BEGIN,
    '- insert:',
    '    - id: docker-sidebar',
    `      name: '${entry.replaceAll("'", "''")}'`,
    END,
  ].join('\n')
}

function stripBlock(text) {
  const start = text.indexOf(BEGIN)
  if (start === -1) return { text, found: false }
  const end = text.indexOf(END, start)
  if (end === -1) throw new Error('found the begin marker but no end marker; repair cordis.patch.yml by hand')
  let before = text.slice(0, start).replace(/\n+$/u, '\n')
  let after = text.slice(end + END.length).replace(/^\n+/u, '')
  if (before === '\n') before = ''
  const joined = `${before}${after}`
  return { text: joined.endsWith('\n') || joined === '' ? joined : `${joined}\n`, found: true }
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const profileDir = join(options.home, 'profiles', options.profile)
  const patchPath = join(profileDir, 'cordis.patch.yml')
  if (!(await exists(profileDir))) throw new Error(`profile directory does not exist: ${profileDir}`)

  const original = (await exists(patchPath)) ? await readFile(patchPath, 'utf8') : ''
  const stripped = stripBlock(original)
  let next = stripped.text
  let action
  if (options.remove) {
    if (!stripped.found) {
      console.log(`install-profile: no ${BEGIN} block in ${patchPath}; nothing to remove`)
      return
    }
    action = 'remove'
  } else {
    const block = blockFor(options.pluginRoot)
    const body = next.replace(/\n+$/u, '')
    next = `${body.length > 0 ? `${body}\n\n` : ''}${block}\n`
    action = stripped.found ? 'replace' : 'insert'
  }

  if (next === original) {
    console.log(`install-profile: ${patchPath} is already up to date`)
    return
  }
  if (options.dryRun) {
    console.log(`install-profile: dry run (${action}) ${patchPath}`)
    console.log(next)
    return
  }

  const backupPath = `${patchPath}.docker.bak`
  if (!(await exists(backupPath)) && (await exists(patchPath))) {
    await copyFile(patchPath, backupPath)
    console.log(`install-profile: backed up ${patchPath} -> ${backupPath}`)
  }
  await writeFile(patchPath, next)
  console.log(`install-profile: ${action}ed docker-sidebar row in ${patchPath}`)
  console.log('install-profile: dsh-hmr should reload the profile now; if the Docker entry does not appear, refresh the GUI (host changes need an app restart).')
}

main().catch((error) => {
  console.error(`install-profile: ${error.message}`)
  process.exitCode = 1
})
