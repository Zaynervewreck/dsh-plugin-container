/** Single active command controller shared by the console and quick actions. */

import { DockerApiError, isAbortError } from './api.js'

const POLL_MS = 400
const UI_OUTPUT_LIMIT = 1_500_000

/** @param {number} ms */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** @param {string} text */
function trimOutput(text) {
  if (text.length <= UI_OUTPUT_LIMIT) return { text, truncated: false }
  return { text: `…[前面的输出已省略]\n${text.slice(-UI_OUTPUT_LIMIT)}`, truncated: true }
}

export class RunController {
  /** @param {{call: Function}} api */
  constructor(api) {
    this.api = api
    this.snapshot = {
      run: null,
      stdout: '',
      stderr: '',
      truncated: false,
      error: null,
    }
    this.subscribers = new Set()
    this.generation = 0
    this.stdoutOffset = 0
    this.stderrOffset = 0
    this.polling = false
    this.onFinished = undefined
  }

  subscribe = (listener) => {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  getSnapshot = () => this.snapshot

  /** @param {Partial<typeof this.snapshot>} patch */
  update(patch) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of [...this.subscribers]) listener()
  }

  get active() {
    const status = this.snapshot.run?.status
    return status === 'running' || status === 'cancelling'
  }

  /**
   * Start one docker command. Throws DockerApiError on validation/transport
   * errors, including `docker/confirmation-required`.
   */
  async start(input) {
    if (this.active) throw new DockerApiError('docker/run-active', '已有命令正在运行，请先取消')
    const generation = ++this.generation
    this.polling = false
    this.stdoutOffset = 0
    this.stderrOffset = 0
    this.update({ run: null, stdout: '', stderr: '', truncated: false, error: null })
    const value = await this.api.call('run', input)
    if (generation !== this.generation) return value?.run ?? null
    this.update({ run: value?.run ?? null })
    if (value?.run !== undefined && value.run !== null) this.beginPolling(value.run.id, generation)
    return value?.run ?? null
  }

  /** Start a runtime lifecycle action (colima/Docker Desktop/OrbStack). */
  async startRuntime(action, context, confirm = false, provider = 'docker') {
    if (this.active) throw new DockerApiError('docker/run-active', '已有命令正在运行，请先取消')
    const generation = ++this.generation
    this.polling = false
    this.stdoutOffset = 0
    this.stderrOffset = 0
    this.update({ run: null, stdout: '', stderr: '', truncated: false, error: null })
    const value = await this.api.call('runtimeAction', { provider, action, context: context ?? undefined, confirm })
    if (generation !== this.generation) return value
    if (value?.run !== undefined && value.run !== null) {
      this.update({ run: value.run })
      this.beginPolling(value.run.id, generation)
    }
    return value
  }

  /** Start one semantic quick action (provider-specific mapping lives on the host). */
  async startAction(input) {
    if (this.active) throw new DockerApiError('docker/run-active', '已有命令正在运行，请先取消')
    const generation = ++this.generation
    this.polling = false
    this.stdoutOffset = 0
    this.stderrOffset = 0
    this.update({ run: null, stdout: '', stderr: '', truncated: false, error: null })
    const value = await this.api.call('action', input)
    if (generation !== this.generation) return value?.run ?? null
    this.update({ run: value?.run ?? null })
    if (value?.run !== undefined && value.run !== null) this.beginPolling(value.run.id, generation)
    return value?.run ?? null
  }

  /** @param {string} runId @param {number} generation */
  beginPolling(runId, generation) {
    this.polling = true
    const loop = async () => {
      while (this.polling && generation === this.generation) {
        await sleep(POLL_MS)
        if (!this.polling || generation !== this.generation) return
        let value
        try {
          value = await this.api.call('poll', {
            runId,
            stdoutOffset: this.stdoutOffset,
            stderrOffset: this.stderrOffset,
          })
        } catch (error) {
          if (isAbortError(error)) return
          this.update({ error: error instanceof Error ? error.message : String(error) })
          this.polling = false
          return
        }
        if (generation !== this.generation) return
        const stdout = `${this.snapshot.stdout}${value.stdout?.text ?? ''}`
        const stderr = `${this.snapshot.stderr}${value.stderr?.text ?? ''}`
        this.stdoutOffset = value.stdout?.nextOffset ?? this.stdoutOffset
        this.stderrOffset = value.stderr?.nextOffset ?? this.stderrOffset
        const trimmed = trimOutput(stdout)
        const trimmedErr = trimOutput(stderr)
        const run = value.run ?? this.snapshot.run
        this.update({
          run,
          stdout: trimmed.text,
          stderr: trimmedErr.text,
          truncated: this.snapshot.truncated || trimmed.truncated || trimmedErr.truncated || value.stdout?.lossy === true || value.stderr?.lossy === true,
        })
        const status = run?.status
        if (status !== 'running' && status !== 'cancelling') {
          this.polling = false
          this.onFinished?.(run)
          return
        }
      }
    }
    loop().catch((error) => {
      this.update({ error: error instanceof Error ? error.message : String(error) })
      this.polling = false
    })
  }

  async cancel() {
    const run = this.snapshot.run
    if (run === null || (run.status !== 'running' && run.status !== 'cancelling')) return
    try {
      const value = await this.api.call('cancel', { runId: run.id })
      this.update({ run: value?.run ?? run })
    } catch (error) {
      if (!isAbortError(error)) this.update({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  reset() {
    this.generation += 1
    this.polling = false
    this.stdoutOffset = 0
    this.stderrOffset = 0
    this.update({ run: null, stdout: '', stderr: '', truncated: false, error: null })
  }

  dispose() {
    this.generation += 1
    this.polling = false
    const run = this.snapshot.run
    if (run !== null && (run.status === 'running' || run.status === 'cancelling')) {
      this.api.call('cancel', { runId: run.id }).catch(() => {})
    }
    this.subscribers.clear()
  }
}
