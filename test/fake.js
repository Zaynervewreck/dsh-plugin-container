/** Minimal subprocess stand-ins shared by the host tests. */

export class FakeReader {
  constructor() {
    this.text = ''
    this.lossy = false
  }

  readFrom(offset) {
    const from = typeof offset === 'number' && offset >= 0 ? offset : 0
    return {
      text: this.text.slice(from),
      nextOffset: this.text.length,
      lossy: this.lossy && from > 0,
    }
  }
}

export class FakeHandle {
  constructor() {
    this.stdout = new FakeReader()
    this.stderr = new FakeReader()
    this.collected = { stdout: this.stdout, stderr: this.stderr }
    this.terminated = false
    this.done = new Promise((resolve) => {
      this.resolve = resolve
    })
  }

  terminate() {
    this.terminated = true
    this.resolve({ exitCode: null, signal: 'SIGTERM' })
  }

  finish(outcome = { exitCode: 0, signal: null }) {
    this.resolve(outcome)
  }
}

/**
 * Spawn a handle for every request. The responder may synchronously fill the
 * readers and return an outcome; returning undefined keeps the handle running
 * for the test to finish or cancel.
 */
export class FakeSubprocess {
  constructor(respond) {
    this.respond = respond
    this.specs = []
    this.handles = []
  }

  spawn(spec) {
    this.specs.push(spec)
    const handle = new FakeHandle()
    this.handles.push(handle)
    const outcome = this.respond?.(spec, handle)
    if (outcome !== undefined) {
      queueMicrotask(() => handle.finish(outcome))
    }
    return handle
  }
}

/** The real Node binary is always executable; the fake never runs it. */
export const executablePath = process.execPath
