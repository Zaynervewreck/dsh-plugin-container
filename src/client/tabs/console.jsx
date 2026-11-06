/** Command terminal: shell-free docker argv, live output, history, cancel. */
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  Button,
  CopyButton,
  Spinner,
  cx,
  formatDuration,
  formatTime,
} from '../components.jsx'
import { IconTerminal, IconX } from '../icons.jsx'
import { readHistory, writeHistory } from '../store.js'

const QUICK_DOCKER = ['ps -a', 'images', 'volume ls', 'network ls', 'compose ls', 'system df', 'info', 'version']
const QUICK_APPLE = ['ls -a', 'image ls', 'volume ls', 'network ls', 'system df', 'system version']
const SENSITIVE = /(?:^|\s)(login|logout|--password(?:-stdin)?|--token|--registry-token)(?:\s|=|$)/u

function statusLabel(t, status) {
  if (status === 'running') return t('commandRunning')
  if (status === 'cancelling') return t('stopping')
  if (status === 'cancelled') return t('cancelled')
  if (status === 'timed-out') return t('timedOut')
  if (status === 'failed') return t('failed')
  return t('commandFinished')
}

export default function ConsoleTab({ t, provider, runs, runState, context, status, cwd, onCwdChange, draft, setDraft, onRun }) {
  const [history, setHistory] = useState(() => readHistory())
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [now, setNow] = useState(() => Date.now())
  const [stick, setStick] = useState(true)
  const preRef = useRef(null)
  const run = runState?.run ?? null
  const active = run !== null && (run.status === 'running' || run.status === 'cancelling')
  const output = runState?.stdout ?? ''
  const stderr = runState?.stderr ?? ''
  const combined = stderr === '' ? output : `${output}${output.endsWith('\n') || output === '' ? '' : '\n'}\n[stderr]\n${stderr}`
  const hasOutput = combined.trim() !== ''
  const runId = run?.id

  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])

  useEffect(() => {
    if (runId !== undefined) setStick(true)
  }, [runId])

  useEffect(() => {
    if (!stick) return
    const element = preRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [combined, stick, run?.status])

  const addHistory = (command) => {
    if (SENSITIVE.test(command)) return
    setHistory((current) => {
      const next = [command, ...current.filter((entry) => entry !== command)].slice(0, 50)
      writeHistory(next)
      return next
    })
  }

  const submit = async (event) => {
    event?.preventDefault()
    const command = draft.trim()
    if (command === '' || active) return
    addHistory(command)
    setHistoryIndex(-1)
    await onRun({
      command,
      context: context ?? undefined,
      cwd: cwd.trim() === '' ? undefined : cwd.trim(),
      title: provider === 'apple-container' ? 'container' : 'docker',
    })
  }

  const navigateHistory = (event) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    if (history.length === 0) return
    event.preventDefault()
    if (event.key === 'ArrowUp') {
      const next = historyIndex < 0 ? 0 : Math.min(historyIndex + 1, history.length - 1)
      setHistoryIndex(next)
      setDraft(history[next])
    } else {
      const next = historyIndex - 1
      if (next < 0) {
        setHistoryIndex(-1)
        setDraft('')
      } else {
        setHistoryIndex(next)
        setDraft(history[next])
      }
    }
  }

  const elapsed = run?.startedAt !== undefined ? (run.endedAt ?? (active ? now : run.endedAt)) - run.startedAt : undefined
  const isApple = provider === 'apple-container'
  const commandPrefix = isApple ? 'container' : 'docker'
  const quick = useMemo(() => (isApple ? QUICK_APPLE : QUICK_DOCKER), [isApple])

  return (
    <div className="dsh-docker-console">
      <form className="dsh-docker-console-form" onSubmit={submit}>
        <div className="dsh-docker-console-row">
          <span className="dsh-docker-console-prompt">$</span>
          <input
            className="dsh-docker-input dsh-docker-console-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value)
              setHistoryIndex(-1)
            }}
            onKeyDown={navigateHistory}
            placeholder={isApple ? t('appleCommandPlaceholder') : t('commandPlaceholder')}
            aria-label={isApple ? t('appleCommandPlaceholder') : t('commandPlaceholder')}
            spellCheck="false"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {active ? (
            <Button type="button" variant="danger" onClick={() => runs.cancel()}><IconX size={13} /> {t('cancel')}</Button>
          ) : (
            <Button type="submit" variant="primary" disabled={draft.trim() === ''}><IconTerminal size={13} /> {t('run')}</Button>
          )}
        </div>
        <div className="dsh-docker-console-meta">
          <span className="dsh-docker-console-hint">{isApple ? t('providerLabel') : t('contextLabel')}: <span className="dsh-docker-mono">{isApple ? t('providerApple') : context ?? t('noContext')}</span></span>
          <span className="dsh-docker-console-hint">·</span>
          <span className="dsh-docker-console-hint">{t('cwd')}</span>
          <input
            className="dsh-docker-input dsh-docker-console-cwd"
            value={cwd}
            onChange={(event) => onCwdChange(event.target.value)}
            placeholder={t('cwdPlaceholder')}
            aria-label={t('cwd')}
            spellCheck="false"
          />
          <span className="dsh-docker-console-hint dsh-docker-truncate">{t('shellHint')}</span>
        </div>
        <div className="dsh-docker-chip-row" style={{ alignItems: 'center' }}>
          <span className="dsh-docker-console-hint">{t('quickCommands')}</span>
          {quick.map((command) => (
            <button key={command} type="button" className="dsh-docker-quick" onClick={() => setDraft(`${commandPrefix} ${command}`)}>
              {command}
            </button>
          ))}
          {history.length > 0 && (
            <>
              <span className="dsh-docker-console-hint" style={{ marginLeft: 4 }}>{t('history')}</span>
              {history.slice(0, 4).map((command, index) => (
                <button key={`${command}-${index}`} type="button" className="dsh-docker-quick" title={command} onClick={() => setDraft(command)}>
                  {command.length > 28 ? `${command.slice(0, 28)}…` : command}
                </button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => { setHistory([]); writeHistory([]) }}>{t('resetHistory')}</Button>
            </>
          )}
        </div>
      </form>

      <div className="dsh-docker-console-output">
        <div className="dsh-docker-output-head">
          <div className="dsh-docker-output-title">
            <IconTerminal size={14} />
            {run !== null ? <span className="dsh-docker-output-cmd" title={run.displayCommand}>{run.displayCommand}</span> : <span>{t('terminal')}</span>}
          </div>
          <div className="dsh-docker-output-actions">
            {runState?.truncated === true && <span className="dsh-docker-chip">{t('truncation')}</span>}
            <CopyButton text={combined} label={t('copy')} copiedLabel={t('copied')} className="dsh-docker-btn dsh-docker-sm" />
            <Button size="sm" onClick={() => runs.reset()} disabled={run === null && !hasOutput}>{t('clear')}</Button>
          </div>
        </div>
        {runState?.error !== undefined && runState?.error !== null && runState.error !== '' ? (
          <pre className="dsh-docker-output-pre" style={{ color: 'var(--dsw-alias-label-error)' }}>{runState.error}</pre>
        ) : (
          <pre
            ref={preRef}
            className={cx('dsh-docker-output-pre', !hasOutput && 'dsh-docker-no-output')}
            onScroll={() => {
              const element = preRef.current
              if (element === null) return
              setStick(element.scrollHeight - element.scrollTop - element.clientHeight < 28)
            }}
          >
            {hasOutput ? combined : t('noOutput')}
          </pre>
        )}
        <div className="dsh-docker-run-status" data-status={run?.status ?? 'idle'}>
          <span className="dsh-docker-dot" />
          {run === null ? <span>{t('noActiveRun')}</span> : (
            <>
              <span>{statusLabel(t, run.status)}</span>
              {run.exitCode !== null && run.exitCode !== undefined && <span>{t('exitCode')}: <span className="dsh-docker-mono">{run.exitCode}</span></span>}
              {elapsed !== undefined && <span>{t('elapsed')}: <span className="dsh-docker-mono">{formatDuration(Math.max(0, elapsed))}</span></span>}
              <span>{isApple ? t('providerLabel') : t('contextLabel')}: <span className="dsh-docker-mono">{isApple ? t('providerApple') : run.context ?? context ?? '—'}</span></span>
              <span className="dsh-docker-muted">{formatTime(run.startedAt)}</span>
              {active && <Spinner size={12} />}
            </>
          )}
          <span style={{ flex: 1 }} />
          <span className="dsh-docker-muted dsh-docker-mono">{isApple ? status?.runtime?.details?.status ?? '' : status?.context?.endpoint ?? ''}</span>
        </div>
      </div>
    </div>
  )
}
