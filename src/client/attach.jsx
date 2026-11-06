/** Interactive PTY attach viewer: raw output plus keyboard/paste input. */
import { useEffect, useRef, useState } from 'react'

import { Button, CopyButton, Modal, Spinner } from './components.jsx'

/** Keep common terminal output readable without pulling xterm into this modal. */
function cleanTerminal(text) {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/gu, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/\x1b[@-_]/gu, '')
    .replace(/\r/gu, '')
}

function statusLabel(t, status) {
  if (status === 'running') return t('attachRunning')
  if (status === 'exited') return t('attachExited')
  if (status === 'failed') return t('attachFailed')
  if (status === 'closed') return t('attachClosed')
  return t('attachStarting')
}

function keyBytes(event) {
  if (event.metaKey) return null
  if (event.ctrlKey && event.key.length === 1) {
    const code = event.key.toUpperCase().charCodeAt(0)
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64)
    return null
  }
  if (event.altKey) return null
  if (event.key === 'Enter') return '\r'
  if (event.key === 'Backspace') return '\x7f'
  if (event.key === 'Tab') return '\t'
  if (event.key === 'Escape') return '\x1b'
  if (event.key === 'ArrowUp') return '\x1b[A'
  if (event.key === 'ArrowDown') return '\x1b[B'
  if (event.key === 'ArrowRight') return '\x1b[C'
  if (event.key === 'ArrowLeft') return '\x1b[D'
  if (event.key === 'Home') return '\x1b[H'
  if (event.key === 'End') return '\x1b[F'
  if (event.key === 'Delete') return '\x1b[3~'
  if (event.key === 'PageUp') return '\x1b[5~'
  if (event.key === 'PageDown') return '\x1b[6~'
  if (event.key.length === 1) return event.key
  return null
}

export default function AttachDialog({ open, t, mode = 'attach', session, output, loading, error, onInput, onClose }) {
  const screenRef = useRef(null)
  const preRef = useRef(null)
  const [stick, setStick] = useState(true)

  useEffect(() => {
    if (!open) return undefined
    setStick(true)
    const timer = setTimeout(() => screenRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!stick) return
    const element = preRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [output, stick])

  const running = session?.status === 'running'
  const title = (session?.mode ?? mode) === 'exec' ? t('execTitle') : t('attachTitle')
  const shown = cleanTerminal(output)
  return (
    <Modal
      open={open}
      title={`${title} · ${session?.containerName ?? ''}`}
      subtitle={session?.command ?? undefined}
      wide
      onClose={onClose}
      closeLabel={t('close')}
      footer={
        <>
          <span className="dsh-docker-muted">{t('attachInputHint')}</span>
          <span style={{ flex: 1 }} />
          {session?.exitCode !== null && session?.exitCode !== undefined && <span className="dsh-docker-muted">{t('exitCode')}: {session.exitCode}</span>}
          <CopyButton text={shown} label={t('copy')} copiedLabel={t('copied')} />
          <Button size="sm" onClick={onClose}>{t((session?.mode ?? mode) === 'exec' ? 'execClose' : 'attachClose')}</Button>
        </>
      }
    >
      <div className="dsh-docker-attach-status">
        <span className="dsh-docker-status" data-state={running ? 'running' : session?.status === 'failed' ? 'error' : 'stopped'}>
          <span className="dsh-docker-dot" />
          {statusLabel(t, session?.status)}
        </span>
        <span className="dsh-docker-muted">{session?.cols ?? 120} × {session?.rows ?? 30}</span>
      </div>
      <div
        ref={screenRef}
        className="dsh-docker-attach-screen"
        tabIndex={0}
        role="textbox"
        aria-label={title}
        onKeyDown={(event) => {
          if (!running || loading) return
          const data = keyBytes(event)
          if (data === null) return
          event.preventDefault()
          onInput(data)
        }}
        onPaste={(event) => {
          if (!running || loading) return
          event.preventDefault()
          const text = event.clipboardData.getData('text')
          if (text !== '') onInput(text)
        }}
      >
        {loading ? (
          <div className="dsh-docker-attach-loading"><Spinner size={16} /> {t('attachStarting')}</div>
        ) : error !== null ? (
          <pre className="dsh-docker-attach-pre dsh-docker-attach-error">{error.message ?? String(error)}</pre>
        ) : shown === '' ? (
          <pre className="dsh-docker-attach-pre dsh-docker-no-output">{t('attachHint')}</pre>
        ) : (
          <pre
            ref={preRef}
            className="dsh-docker-attach-pre"
            onScroll={() => {
              const element = preRef.current
              if (element === null) return
              setStick(element.scrollHeight - element.scrollTop - element.clientHeight < 28)
            }}
          >{shown}</pre>
        )}
      </div>
    </Modal>
  )
}
