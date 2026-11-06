/** Push a local image to a registry, retagging it first when the target differs. */
import { useEffect, useMemo, useState } from 'react'

import { Button, Modal, fill } from './components.jsx'

const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/u
const PRESETS = [
  { label: 'Docker Hub', prefix: 'myname/' },
  { label: 'GHCR', prefix: 'ghcr.io/myname/' },
  { label: 'Quay', prefix: 'quay.io/myname/' },
]

/** `ghcr.io/me/app:1` -> `app:1` */
function lastSegment(reference) {
  const withoutDigest = reference.split('@')[0]
  return withoutDigest.slice(withoutDigest.lastIndexOf('/') + 1)
}

export default function PushImageDialog({ open, t, provider, image, onClose, onSubmit }) {
  const [target, setTarget] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTarget(image)
    setError(null)
    setBusy(false)
  }, [open, image])

  const trimmed = target.trim()
  const valid = IMAGE_REF.test(trimmed)
  const needsNamespace = valid && !trimmed.split('@')[0].includes('/')
  const retag = valid && trimmed !== image
  const command = useMemo(() => {
    const cli = provider === 'apple-container' ? 'container image' : 'docker'
    const lines = []
    if (retag) lines.push(`${cli} tag ${image} ${trimmed}`)
    lines.push(`${cli} push ${valid ? trimmed : '…'}`)
    return lines.join('\n')
  }, [image, provider, retag, trimmed, valid])

  const submit = async (event) => {
    event?.preventDefault()
    if (!valid) {
      setError(t('pullInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ kind: 'image', action: 'push', id: image, target: trimmed, name: trimmed })
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('imgPushTitle')}
      subtitle={provider === 'apple-container' ? t('providerApple') : t('providerDocker')}
      onClose={onClose}
      closeLabel={t('close')}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t('modalCancel')}</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy || !valid}>
            {busy ? t('imgPushing') : t('imgPushStart')}
          </Button>
        </>
      }
    >
      <form className="dsh-docker-run-form" onSubmit={submit}>
        <label className="dsh-docker-field">
          <span>{t('imgPushSource')}</span>
          <input className="dsh-docker-input dsh-docker-mono" value={image} readOnly />
        </label>
        <label className="dsh-docker-field">
          <span>{t('imgPushTarget')}</span>
          <input
            className="dsh-docker-input dsh-docker-mono"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            spellCheck="false"
            autoFocus
          />
          <span className="dsh-docker-hint">{t('imgPushTargetHint')}</span>
        </label>
        <div className="dsh-docker-chip-row">
          <span className="dsh-docker-hint">{t('imgPushPresets')}</span>
          {PRESETS.map((preset) => (
            <Button key={preset.label} size="sm" variant="ghost" onClick={() => setTarget(`${preset.prefix}${lastSegment(image)}`)}>
              {preset.label}
            </Button>
          ))}
        </div>
        {needsNamespace && (
          <div className="dsh-docker-hint dsh-docker-hint-warn">{fill(t('imgPushNeedsNamespace'), { name: lastSegment(trimmed) })}</div>
        )}
        {retag && <div className="dsh-docker-hint">{t('imgPushRetag')}</div>}
        <label className="dsh-docker-field">
          <span>{t('imgCommandPreview')}</span>
          <pre className="dsh-docker-preview">{command}</pre>
        </label>
        <div className="dsh-docker-hint">{provider === 'apple-container' ? t('imgPushLoginApple') : t('imgPushLoginDocker')}</div>
        {error !== null && <div className="dsh-docker-form-error">{error}</div>}
      </form>
    </Modal>
  )
}
