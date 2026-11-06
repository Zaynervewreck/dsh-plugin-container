/** Start a new container from a local image or a manually entered reference. */
import { useEffect, useMemo, useState } from 'react'

import { Button, Modal } from './components.jsx'
import { useDockerList } from './hooks.js'

export default function RunContainerDialog({
  open,
  t,
  api,
  provider,
  context,
  status,
  refreshToken = 0,
  features = [],
  initialImage = '',
  onClose,
  onSubmit,
}) {
  const [image, setImage] = useState('')
  const [manual, setManual] = useState(false)
  const [customImage, setCustomImage] = useState('')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [ports, setPorts] = useState('')
  const [env, setEnv] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const images = useDockerList(api, provider, 'images', context, {
    refreshToken,
    enabled: open && features.includes('run') && status?.daemon?.state === 'running',
  })

  const options = useMemo(() => {
    const names = []
    for (const item of images.data?.items ?? []) {
      if (typeof item.name === 'string' && item.name !== '' && item.name !== '<none>' && !names.includes(item.name)) names.push(item.name)
    }
    if (initialImage !== '' && !names.includes(initialImage)) names.unshift(initialImage)
    return names
  }, [images.data, initialImage])

  useEffect(() => {
    if (!open) return
    setImage(initialImage)
    setManual(false)
    setCustomImage(initialImage)
    setName('')
    setCommand('')
    setPorts('')
    setEnv('')
    setError(null)
    setBusy(false)
  }, [open, initialImage])

  useEffect(() => {
    if (!open || manual) return
    if (initialImage !== '' && options.includes(initialImage)) {
      setImage(initialImage)
      return
    }
    if (image === '' || !options.includes(image)) {
      if (options.length > 0) setImage(options[0])
    }
  }, [open, options, image, manual, initialImage])

  const reset = () => {
    setImage('')
    setManual(false)
    setCustomImage('')
    setName('')
    setCommand('')
    setPorts('')
    setEnv('')
    setError(null)
    setBusy(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async (event) => {
    event?.preventDefault()
    const ref = (manual ? customImage : image).trim()
    if (ref === '') {
      setError(t('runImageRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        kind: 'container',
        action: 'run',
        image: ref,
        name: name.trim() === '' ? undefined : name.trim(),
        command: command.trim() === '' ? undefined : command.trim(),
        ports: ports.split(/[\n,]+/u).map((entry) => entry.trim()).filter(Boolean),
        env: env.split(/\n/u).map((entry) => entry.trim()).filter(Boolean),
      })
      reset()
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('runContainerTitle')}
      subtitle={provider === 'apple-container' ? t('providerApple') : t('providerDocker')}
      onClose={close}
      closeLabel={t('close')}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={close} disabled={busy}>{t('modalCancel')}</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy}>
            {busy ? t('starting') : t('runStart')}
          </Button>
        </>
      }
    >
      <form className="dsh-docker-run-form" onSubmit={submit}>
        <label className="dsh-docker-field">
          <span>{t('runImage')}</span>
          <div className="dsh-docker-image-picker">
            <select
              className="dsh-docker-select"
              value={manual ? '__custom__' : image}
              onChange={(event) => {
                if (event.target.value === '__custom__') {
                  setManual(true)
                  setCustomImage(image)
                } else {
                  setManual(false)
                  setImage(event.target.value)
                }
              }}
              autoFocus
            >
              <option value="">{t('runImageSelect')}</option>
              {options.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value="__custom__">{t('runImageCustom')}</option>
            </select>
            <Button size="sm" variant="ghost" onClick={images.reload} disabled={images.loading}>{t('refresh')}</Button>
          </div>
          {manual && (
            <input
              className="dsh-docker-input"
              value={customImage}
              onChange={(event) => setCustomImage(event.target.value)}
              placeholder={t('runImagePlaceholder')}
              spellCheck="false"
            />
          )}
          {images.data !== null && options.length === 0 && !manual && (
            <span className="dsh-docker-muted">{t('runImageListEmpty')}</span>
          )}
        </label>
        <div className="dsh-docker-run-grid">
          <label className="dsh-docker-field">
            <span>{t('runName')}</span>
            <input className="dsh-docker-input" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('runNamePlaceholder')} spellCheck="false" />
          </label>
          <label className="dsh-docker-field">
            <span>{t('runPorts')}</span>
            <input className="dsh-docker-input" value={ports} onChange={(event) => setPorts(event.target.value)} placeholder={t('runPortsPlaceholder')} spellCheck="false" />
          </label>
        </div>
        <label className="dsh-docker-field">
          <span>{t('runCommand')}</span>
          <input className="dsh-docker-input" value={command} onChange={(event) => setCommand(event.target.value)} placeholder={t('runCommandPlaceholder')} spellCheck="false" />
        </label>
        <label className="dsh-docker-field">
          <span>{t('runEnv')}</span>
          <textarea className="dsh-docker-input dsh-docker-textarea" value={env} onChange={(event) => setEnv(event.target.value)} placeholder={t('runEnvPlaceholder')} spellCheck="false" rows={3} />
        </label>
        <div className="dsh-docker-muted">{t('runDetachedHint')}</div>
        {error !== null && <div className="dsh-docker-form-error">{error}</div>}
      </form>
    </Modal>
  )
}
