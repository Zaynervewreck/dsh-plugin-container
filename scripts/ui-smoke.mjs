#!/usr/bin/env node
/**
 * Playwright smoke test for the Docker sidebar.
 *
 * Usage:
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome node scripts/ui-smoke.mjs "http://127.0.0.1:PORT/?token=..."
 *
 * The instance must be disposable: this script runs read-only Docker commands,
 * starts/cancels `docker events`, and opens then cancels one destructive
 * confirmation. It never removes a resource or stops the runtime.
 */
import { strict as assert } from 'node:assert'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const url = process.argv[2]
if (url === undefined) {
  console.error('usage: node scripts/ui-smoke.mjs <authenticated-url>')
  process.exit(2)
}

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined
const browser = await chromium.launch({
  headless: true,
  ...(executablePath === undefined ? {} : { executablePath }),
  args: ['--no-proxy-server'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const consoleErrors = []
const pageErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => pageErrors.push(error.stack || error.message))

const wait = (ms) => page.waitForTimeout(ms)
const tab = (name) => page.getByRole('tab', { name })
const settleList = async (emptyText) => {
  await page.waitForFunction((text) => {
    const page = document.querySelector('[data-dsh-docker-page]')
    const body = page === null ? '' : page.innerText
    return body.includes(text) || document.querySelectorAll('.dsh-docker-table tbody tr').length > 0
  }, emptyText, { timeout: 15_000 })
}
const screenshot = async (name) => {
  await mkdir(resolve('docs'), { recursive: true })
  await page.screenshot({ path: resolve('docs', name), fullPage: true })
  console.log(`screenshot: docs/${name}`)
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await wait(2500)

  // Dismiss the preview notice and the first-run account dialog.
  const continueButton = page.getByRole('button', { name: '继续' })
  if (await continueButton.count() > 0) await continueButton.first().click({ force: true }).catch(() => {})
  await wait(600)
  await page.keyboard.press('Escape').catch(() => {})
  await wait(500)

  const dockerEntry = page.getByRole('button', { name: '容器' })
  assert.ok(await dockerEntry.count() > 0, '容器 entry is missing from the left sidebar')
  await dockerEntry.first().click({ force: true })
  await page.locator('[data-dsh-docker-page]').waitFor({ state: 'visible', timeout: 20_000 })
  await wait(2500)

  assert.equal(await page.locator('[data-dsh-docker-page]').getAttribute('data-docker-daemon'), 'running')
  assert.ok((await page.locator('body').innerText()).includes('colima'))
  assert.ok((await page.locator('body').innerText()).includes('容器运行时'))
  await screenshot('docker-overview.png')

  await tab(/^容器/).click()
  await settleList('没有容器')
  assert.equal(await tab(/^容器/).getAttribute('aria-selected'), 'true')

  await tab(/^镜像/).click()
  await settleList('没有镜像')
  assert.equal(await tab(/^镜像/).getAttribute('aria-selected'), 'true')

  const runFromImage = page.getByRole('button', { name: '用此镜像启动容器', exact: true })
  if (await runFromImage.count() > 0) {
    await runFromImage.first().click()
    const startDialog = page.locator('[role=dialog]')
    await startDialog.waitFor({ timeout: 10_000 })
    await wait(500)
    const picked = await startDialog.locator('select').inputValue()
    assert.notEqual(picked, '', 'image start dialog should preselect the image')
    await startDialog.getByRole('button', { name: '取消', exact: true }).click()
  }

  await tab(/^卷/).click()
  await settleList('没有卷')
  await screenshot('docker-volumes.png')

  await tab(/^网络/).click()
  await settleList('没有网络')

  await tab(/^Compose/).click()
  await settleList('没有 Compose 项目')

  await tab(/命令/).click()
  await wait(500)
  const input = page.locator('.dsh-docker-console-input')
  await input.fill('docker ps -a')
  await page.locator('.dsh-docker-console-form button[type=submit]').click()
  await page.locator('.dsh-docker-run-status[data-status="exited"]').waitFor({ timeout: 20_000 })
  const output = await page.locator('.dsh-docker-output-pre').innerText()
  assert.ok(output.includes('CONTAINER ID'), `unexpected docker ps output: ${output.slice(0, 200)}`)
  await screenshot('docker-console.png')

  await input.fill('events')
  await page.locator('.dsh-docker-console-form button[type=submit]').click()
  await page.locator('.dsh-docker-run-status[data-status="running"]').waitFor({ timeout: 15_000 })
  await page.locator('.dsh-docker-console-form button').filter({ hasText: '取消' }).first().click()
  await page.locator('.dsh-docker-run-status[data-status="cancelled"]').waitFor({ timeout: 15_000 })

  await input.fill('docker rm -f __dsh_missing__')
  await page.locator('.dsh-docker-console-form button[type=submit]').click()
  const dialog = page.locator('[role=dialog]')
  await dialog.waitFor({ timeout: 10_000 })
  const dialogText = await dialog.innerText()
  assert.ok(dialogText.includes('docker --context colima rm -f __dsh_missing__'), `confirmation should show the exact command: ${dialogText}`)
  await dialog.getByRole('button', { name: '取消' }).click()
  await wait(400)

  await tab(/^镜像/).click()
  await settleList('没有镜像')
  if (await page.locator('.dsh-docker-table tbody tr').count() === 0) {
    await tab(/^卷/).click()
    await settleList('没有卷')
  }
  await page.locator('.dsh-docker-table').getByRole('button', { name: '检查' }).first().click()
  const inspectDialog = page.locator('[role=dialog]')
  await inspectDialog.waitFor({ timeout: 10_000 })
  const json = await inspectDialog.locator('.dsh-docker-json').innerText()
  assert.ok(json.includes('"Name"') || json.includes('"Driver"'), 'inspect dialog should show JSON')
  await inspectDialog.locator('.dsh-docker-modal-foot').getByRole('button', { name: '关闭' }).click()

  const providerSwitch = page.locator('.dsh-docker-provider-switch')
  if (await providerSwitch.count() > 0) {
    const appleButton = providerSwitch.getByRole('button', { name: 'Apple container' })
    if (await appleButton.count() > 0) {
      await appleButton.click()
      await page.waitForFunction(() => document.querySelector('[data-dsh-docker-page]')?.getAttribute('data-docker-provider') === 'apple-container', undefined, { timeout: 15_000 })
      await wait(2500)
      const appleDaemon = await page.locator('[data-dsh-docker-page]').getAttribute('data-docker-daemon')
      if (appleDaemon === 'running') {
        assert.equal(await tab(/^Compose/).count(), 0, 'Apple container must not expose the Compose tab')
        await tab(/^概览/).click()
        await wait(1200)
        await screenshot('apple-container.png')
        await tab(/^容器/).click()
        await settleList('没有容器')
        await tab(/^命令/).click()
        const appleInput = page.locator('.dsh-docker-console-input')
        await appleInput.fill('container ls -a')
        await page.locator('.dsh-docker-console-form button[type=submit]').click()
        await page.locator('.dsh-docker-run-status[data-status="exited"]').waitFor({ timeout: 20_000 })
        const appleOutput = await page.locator('.dsh-docker-output-pre').innerText()
        assert.ok(appleOutput.includes('ID'), `unexpected container ls output: ${appleOutput.slice(0, 200)}`)
      } else {
        assert.ok((await page.locator('[data-dsh-docker-page]').innerText()).includes('Apple container 服务未启动'), 'stopped Apple provider should explain the service state')
      }
      await providerSwitch.getByRole('button', { name: 'Docker' }).click()
      await page.waitForFunction(() => document.querySelector('[data-dsh-docker-page]')?.getAttribute('data-docker-provider') === 'docker', undefined, { timeout: 15_000 })
      await page.waitForFunction(() => document.querySelector('[data-dsh-docker-page]')?.getAttribute('data-docker-daemon') === 'running', undefined, { timeout: 20_000 })
    }
  }

  assert.deepEqual(pageErrors, [], `page errors: ${pageErrors.join('\n')}`)
  const relevantConsoleErrors = consoleErrors.filter((line) => /docker|dsh-plugin-container/iu.test(line))
  assert.deepEqual(relevantConsoleErrors, [], `console errors: ${relevantConsoleErrors.join('\n')}`)
  console.log('ui-smoke: ok')
} finally {
  await browser.close()
}
