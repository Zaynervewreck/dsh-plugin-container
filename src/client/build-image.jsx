/** Build an image from a project directory, validating the directory as the user types. */
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button, Modal, fill } from './components.jsx'
import { PLATFORMS } from './platforms.js'

const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/u

export default function BuildImageDialog({ open, t, api, provider, defaultDir = '', pickDirectory, onClose, onSubmit }) {
  const [dir, setDir] = useState('')
  const [info, setInfo] = useState(null)
  const [file, setFile] = useState('')
  const [tag, setTag] = useState('')
  const [tagEdited, setTagEdited] = useState(false)
  const [platform, setPlatform] = useState('')
  const [noCache, setNoCache] = useState(false)
  const [buildArgs, setBuildArgs] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)
  const canPick = typeof pickDirectory === 'function' && (pickDirectory.available?.() ?? true)

  const choose = async () => {
    try {
      const picked = await pickDirectory()
      if (typeof picked === 'string' && picked !== '') {
        setDir(picked)
        setError(null)
      }
    } catch (pickError) {
      setError(pickError instanceof Error && pickError.message !== 'unsupported' ? pickError.message : t('imgBuildDirPickFailed'))
    }
  }

  useEffect(() => {
    if (!open) return
    setDir(defaultDir)
    setInfo(null)
    setFile('')
    setTag('')
    setTagEdited(false)
    setPlatform('')
    setNoCache(false)
    setBuildArgs('')
    setError(null)
    setBusy(false)
  }, [open, defaultDir])

  // Validate the directory shortly after the user stops typing.
  useEffect(() => {
    if (!open) return undefined
    const path = dir.trim()
    if (path === '') {
      setInfo(null)
      return undefined
    }
    const id = ++requestId.current
    const timer = setTimeout(async () => {
      try {
        const value = await api.call('buildContext', { path })
        if (id !== requestId.current) return
        setInfo(value)
        setFile((current) => (value.dockerfiles.includes(current) ? current : (value.dockerfiles[0] ?? '')))
        if (value.suggestedTag !== '') setTag((current) => (tagEdited || current !== '' ? current : value.suggestedTag))
      } catch {
        if (id === requestId.current) setInfo(null)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [api, dir, open, tagEdited])

  const args = useMemo(() => buildArgs.split(/\n/u).map((line) => line.trim()).filter(Boolean), [buildArgs])
  const tagValid = IMAGE_REF.test(tag.trim())
  const dirOk = info !== null && info.isDirectory && info.dockerfiles.length > 0
  const trimmedDir = dir.trim()
  const dirChecked = info !== null && info.path === trimmedDir

  let dirLine = null
  if (trimmedDir !== '' && !dirChecked) dirLine = { tone: 'hint', text: t('imgBuildDirChecking') }
  else if (dirChecked && !info.exists) dirLine = { tone: 'err', text: t('imgBuildDirMissing') }
  else if (dirChecked && !info.isDirectory) dirLine = { tone: 'err', text: t('imgBuildDirNotDir') }
  else if (dirChecked && info.dockerfiles.length === 0) dirLine = { tone: 'err', text: t('imgBuildDirNoFile') }
  else if (dirChecked) dirLine = { tone: 'ok', text: fill(t('imgBuildDirOk'), { count: info.dockerfiles.length }) }

  const command = useMemo(() => {
    const cli = provider === 'apple-container' ? 'container' : 'docker'
    const parts = [cli, 'build', '-t', tag.trim() || '<name:tag>']
    if (file !== '' && file !== 'Dockerfile') parts.push('-f', file)
    if (platform !== '') parts.push('--platform', platform)
    if (noCache) parts.push('--no-cache')
    for (const arg of args) parts.push('--build-arg', arg)
    parts.push('.')
    return `cd ${trimmedDir || '<dir>'}\n${parts.join(' ')}`
  }, [args, file, noCache, platform, provider, tag, trimmedDir])

  const submit = async (event) => {
    event?.preventDefault()
    if (!dirOk) {
      setError(dirLine?.tone === 'err' ? dirLine.text : t('imgBuildDirPlaceholder'))
      return
    }
    if (!tagValid) {
      setError(t('imgBuildTagRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({
        kind: 'image',
        action: 'build',
        tag: tag.trim(),
        name: tag.trim(),
        contextDir: trimmedDir,
        file: file === '' ? undefined : file,
        platform: platform === '' ? undefined : platform,
        noCache,
        buildArgs: args,
      })
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError))
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={t('imgBuildTitle')}
      subtitle={provider === 'apple-container' ? t('providerApple') : t('providerDocker')}
      onClose={onClose}
      closeLabel={t('close')}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>{t('modalCancel')}</Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy || !dirOk || !tagValid}>
            {busy ? t('imgBuilding') : t('imgBuildStart')}
          </Button>
        </>
      }
    >
      <form className="dsh-docker-run-form" onSubmit={submit}>
        <label className="dsh-docker-field">
          <span>{t('imgBuildDir')}</span>
          <div className="dsh-docker-image-picker">
            <input
              className="dsh-docker-input dsh-docker-mono"
              style={{ flex: 1, minWidth: 0 }}
              value={dir}
              onChange={(event) => setDir(event.target.value)}
              onClick={canPick ? choose : undefined}
              readOnly={canPick}
              placeholder={canPick ? t('imgBuildDirChoose') : t('imgBuildDirPlaceholder')}
              spellCheck="false"
              autoFocus={!canPick}
            />
            {canPick && <Button size="sm" onClick={choose}>{dir.trim() === '' ? t('imgBuildDirChoose') : t('imgBuildDirChange')}</Button>}
          </div>
          {dirLine === null || dirLine.tone === 'hint'
            ? <span className="dsh-docker-hint">{dirLine?.text ?? t('imgBuildDirHint')}</span>
            : <span className={dirLine.tone === 'ok' ? 'dsh-docker-line-ok' : 'dsh-docker-line-err'}>{dirLine.text}</span>}
        </label>
        {dirOk && info.dockerfiles.length > 1 && (
          <label className="dsh-docker-field">
            <span>{t('imgBuildFile')}</span>
            <select className="dsh-docker-select" value={file} onChange={(event) => setFile(event.target.value)}>
              {info.dockerfiles.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        )}
        <label className="dsh-docker-field">
          <span>{t('imgBuildTag')}</span>
          <input
            className="dsh-docker-input dsh-docker-mono"
            value={tag}
            onChange={(event) => {
              setTag(event.target.value)
              setTagEdited(true)
            }}
            placeholder={t('imgBuildTagPlaceholder')}
            spellCheck="false"
          />
          <span className="dsh-docker-hint">{t('imgBuildTagHint')}</span>
        </label>
        <details className="dsh-docker-advanced">
          <summary>{t('imgBuildAdvanced')}</summary>
          <div className="dsh-docker-advanced-body">
            <label className="dsh-docker-field">
              <span>{t('imgBuildPlatform')}</span>
              <select className="dsh-docker-select" value={platform} onChange={(event) => setPlatform(event.target.value)}>
                <option value="">{t('imgBuildPlatformAuto')}</option>
                {PLATFORMS.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="dsh-docker-check">
              <input type="checkbox" checked={noCache} onChange={(event) => setNoCache(event.target.checked)} />
              <span>{t('imgBuildNoCache')}</span>
            </label>
            <label className="dsh-docker-field">
              <span>{t('imgBuildArgs')}</span>
              <textarea
                className="dsh-docker-input dsh-docker-textarea"
                value={buildArgs}
                onChange={(event) => setBuildArgs(event.target.value)}
                placeholder={t('imgBuildArgsPlaceholder')}
                spellCheck="false"
                rows={3}
              />
            </label>
          </div>
        </details>
        <label className="dsh-docker-field">
          <span>{t('imgCommandPreview')}</span>
          <pre className="dsh-docker-preview">{command}</pre>
        </label>
        <div className="dsh-docker-hint">{t('imgBuildHint')}</div>
        {error !== null && <div className="dsh-docker-form-error">{error}</div>}
      </form>
    </Modal>
  )
}
