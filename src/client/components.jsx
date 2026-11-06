/** Small presentational building blocks shared by the Docker tabs. */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { IconAlert, IconCheck, IconCopy, IconSearch, IconSpinner, IconX } from './icons.jsx'

export function cx(...values) {
  return values.filter(Boolean).join(' ')
}

export function Button({ variant = 'ghost', size = 'md', className, type = 'button', children, ...rest }) {
  return (
    <button
      type={type}
      className={cx(
        'dsh-docker-btn',
        variant === 'primary' && 'dsh-docker-primary',
        variant === 'danger' && 'dsh-docker-danger',
        variant === 'danger-solid' && 'dsh-docker-danger-solid',
        variant === 'ghost' && 'dsh-docker-ghost',
        size === 'sm' && 'dsh-docker-sm',
        size === 'lg' && 'dsh-docker-lg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function IconButton({ label, size = 'md', className, children, ...rest }) {
  const [tip, setTip] = useState(null)
  const ref = useRef(null)
  const showTip = () => {
    const rect = ref.current?.getBoundingClientRect()
    if (rect === undefined) return
    const left = Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16)
    setTip({ left, top: Math.max(rect.top - 7, 8) })
  }
  const hideTip = () => setTip(null)
  return (
    <>
      <button
        type="button"
        ref={ref}
        aria-label={label}
        className={cx('dsh-docker-icon-btn', size === 'sm' && 'dsh-docker-sm', className)}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onFocus={showTip}
        onBlur={hideTip}
        {...rest}
      >
        {children}
      </button>
      {tip !== null && createPortal(
        <span className="dsh-docker-tooltip" style={{ left: tip.left, top: tip.top }} role="tooltip">{label}</span>,
        document.body,
      )}
    </>
  )
}

export function Spinner({ size = 16, className }) {
  return <IconSpinner size={size} className={className} />
}

export function StatusDot({ state = 'unknown' }) {
  return <span className="dsh-docker-dot" data-state={state} aria-hidden="true" />
}

export function StateLabel({ state, t }) {
  const normalized = state === 'running' ? 'running'
    : state === 'restarting' ? 'restarting'
      : state === 'paused' ? 'paused'
        : state === 'dead' ? 'dead'
          : 'exited'
  const label = normalized === 'running' ? t('running')
    : normalized === 'restarting' ? t('statusStarting')
      : normalized === 'paused' ? t('statusStarting')
        : normalized === 'dead' ? t('failed')
          : t('stopped')
  return (
    <span className="dsh-docker-state" data-state={normalized}>
      <StatusDot state={normalized} />
      {label}
    </span>
  )
}

export function Modal({ open, title, subtitle, wide, onClose, children, footer, closeLabel = 'Close' }) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="dsh-docker-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div
        className={cx('dsh-docker-modal', wide && 'dsh-docker-modal-wide')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="dsh-docker-modal-head">
          <div>
            <h2 className="dsh-docker-modal-title">{title}</h2>
            {subtitle !== undefined && <p className="dsh-docker-modal-sub">{subtitle}</p>}
          </div>
          <IconButton label={closeLabel} autoFocus onClick={onClose}>
            <IconX size={16} />
          </IconButton>
        </div>
        <div className="dsh-docker-modal-body">{children}</div>
        {footer !== undefined && <div className="dsh-docker-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ open, title, body, command, confirmLabel, cancelLabel, closeLabel = 'Close', danger = false, busy = false, onConfirm, onCancel }) {
  return (
    <Modal
      open={open}
      title={title}
      closeLabel={closeLabel}
      onClose={onCancel}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>{cancelLabel}</Button>
          <Button variant={danger ? 'danger-solid' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner size={14} /> : null}
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={cx(danger && 'dsh-docker-modal-danger')} style={{ whiteSpace: 'pre-wrap' }}>
        <div>{body}</div>
        {command !== undefined && (
          <pre className="dsh-docker-json" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{command}</pre>
        )}
      </div>
    </Modal>
  )
}

export function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null
  return createPortal(
    <div className="dsh-docker-toast-wrap" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="dsh-docker-toast" data-tone={toast.tone}>
          <span style={{ marginTop: 1 }}>
            {toast.tone === 'success' ? <IconCheck size={14} /> : toast.tone === 'error' ? <IconAlert size={14} /> : null}
          </span>
          <span className="dsh-docker-toast-main">{toast.message}</span>
          <IconButton label="Close" size="sm" onClick={() => onDismiss(toast.id)}>
            <IconX size={13} />
          </IconButton>
        </div>
      ))}
    </div>,
    document.body,
  )
}

export function EmptyState({ icon, title, text, action }) {
  return (
    <div className="dsh-docker-empty">
      {icon !== undefined && <span className="dsh-docker-empty-icon">{icon}</span>}
      <div className="dsh-docker-empty-title">{title}</div>
      {text !== undefined && <div className="dsh-docker-empty-text">{text}</div>}
      {action}
    </div>
  )
}

export function ErrorState({ title, text, retryLabel, onRetry }) {
  return (
    <div className="dsh-docker-error">
      <span className="dsh-docker-empty-icon"><IconAlert size={21} /></span>
      <div className="dsh-docker-error-title">{title}</div>
      {text !== undefined && <div className="dsh-docker-error-text">{text}</div>}
      {onRetry !== undefined && <Button onClick={onRetry}>{retryLabel}</Button>}
    </div>
  )
}

export function LoadingSkeleton({ rows = 3 }) {
  return (
    <div className="dsh-docker-skeleton" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="dsh-docker-skel-line" />)}
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, label }) {
  return (
    <label className="dsh-docker-search">
      <span className="dsh-docker-search-icon"><IconSearch size={14} /></span>
      <input
        className="dsh-docker-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        spellCheck="false"
      />
    </label>
  )
}

export function CopyButton({ text, label, copiedLabel, className, children }) {
  const [copied, setCopied] = useState(false)
  const write = async () => {
    try {
      if (navigator.clipboard?.writeText !== undefined) await navigator.clipboard.writeText(text)
      else {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return (
    <Button onClick={write} className={className} title={label}>
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      {children ?? (copied ? copiedLabel : label)}
    </Button>
  )
}

export function Chips({ values, className, mono = false }) {
  if (values.length === 0) return <span className="dsh-docker-muted">—</span>
  return (
    <span className={cx('dsh-docker-chips', className)}>
      {values.map((value, index) => (
        <span key={`${value}-${index}`} className={cx('dsh-docker-chip', mono && 'dsh-docker-chip-code')} title={value}>
          {value}
        </span>
      ))}
    </span>
  )
}

/** @param {number} bytes */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

/** @param {number} ms */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

/** @param {number | undefined} timestamp */
export function formatTime(timestamp) {
  if (typeof timestamp !== 'number') return '—'
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** @param {string} value */
export function shortId(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/^sha256:/u, '').slice(0, 12)
}

/** @param {unknown} value */
export function displayValue(value) {
  if (value === undefined || value === null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

/** @param {unknown} error */
/** Replace `{key}` placeholders in a localized string. */
export function fill(text, values = {}) {
  return String(text).replace(/\{(\w+)\}/gu, (match, key) => (values[key] === undefined ? match : String(values[key])))
}

export function errorMessage(error) {
  if (error === undefined || error === null) return ''
  if (error instanceof Error) return error.message
  return String(error)
}
