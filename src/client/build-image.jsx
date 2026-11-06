/** Build a Docker/Apple image from a Dockerfile. */
import { useEffect, useState } from 'react'

import { Button, Modal } from './components.jsx'

const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/u

export default function BuildImageDialog({ open, t, provider, cwd, onClose, onSubmit }) {
  const [tag, setTag] = useState('')
  const [contextPath, setContextPath] = useState('')
  const [dockerfile, setDockerfile] = useState('Dockerfile')
  const [noCache, setNoCache] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setTag('')
    setContextPath(cwd || '')
    setDockerfile('Dockerfile')
    setNoCache(false)
    setError(null)
    setBusy(false)
  }, [open, cwd])

  const close = () => {
    if (busy) return
    onClose()
  }

  const submit = async (event) => {
    event?.preventDefault()
    const imageTag = tag.trim()
    const context = contextPath.trim()
    if (!IMAGE_REF.test(imageTag)) {
      setError(t('buildInvalidTag'))
      return
    }
    if (!context.startsWith('/')) {
      setError(t('buildInvalidContext'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        kind: 'image',
        action: 'build',
        tag: imageTag,
        contextPath: context,
        dockerfile: dockerfile.trim() === '' ? undefined : dockerfile.trim(),
        noCache,
      })
      setBusy(false)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('buildImageTitle')}
      subtitle={provider === 'apple-container' ? t('providerApple') : t('providerDocker')}
      onClose={close}
      closeLabel={t('close')}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={close} disabled={busy}>{t('modalCancel')}</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy}>
            {busy ? t('starting') : t('buildStart')}
          </Button>
        </>
      }
    >
      <form className="dsh-docker-run-form" onSubmit={submit}>
        <label className="dsh-docker-field">
          <span>{t('buildTag')}</span>
          <input
            className="dsh-docker-input"
            value={tag}
            onChange={(event) => setTag(event.target.value)}
            placeholder="my-app:latest"
            spellCheck="false"
            autoFocus
          />
        </label>
        <label className="dsh-docker-field">
          <span>{t('buildContext')}</span>
          <input
            className="dsh-docker-input"
            value={contextPath}
            onChange={(event) => setContextPath(event.target.value)}
            placeholder="/Users/me/project"
            spellCheck="false"
          />
          <small className="dsh-docker-muted">{t('buildContextHint')}</small>
        </label>
        <label className="dsh-docker-field">
          <span>{t('buildDockerfile')}</span>
          <input
            className="dsh-docker-input"
            value={dockerfile}
            onChange={(event) => setDockerfile(event.target.value)}
            placeholder="Dockerfile"
            spellCheck="false"
          />
        </label>
        <label className="dsh-docker-check">
          <input type="checkbox" checked={noCache} onChange={(event) => setNoCache(event.target.checked)} />
          {t('buildNoCache')}
        </label>
        {error !== null && <div className="dsh-docker-form-error">{error}</div>}
      </form>
    </Modal>
  )
}
