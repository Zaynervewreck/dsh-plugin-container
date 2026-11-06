/** Images tab with search, inspect/remove actions, and a pull form. */
import { useMemo, useState } from 'react'

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingSkeleton,
  SearchInput,
  displayValue,
  shortId,
} from '../components.jsx'
import BuildImageDialog from '../build-image.jsx'
import { useDockerList } from '../hooks.js'
import { IconAlert, IconBuild, IconDownload, IconImage, IconInfo, IconPlay, IconTrash, IconUpload } from '../icons.jsx'

const IMAGE_REF = /^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$/u

export default function ImagesTab({ t, api, provider, context, status, refreshToken, features = [], cwd, onAction, onRunContainer, onInspect, onNotify }) {
  const showArchitecture = features.includes('image-architecture')
  const [search, setSearch] = useState('')
  const [pull, setPull] = useState('')
  const [buildOpen, setBuildOpen] = useState(false)
  const enabled = status?.daemon?.state === 'running'
  const list = useDockerList(api, provider, 'images', context, { refreshToken, enabled })
  const items = list.data?.items ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return items
    return items.filter((item) => `${item.name} ${item.id} ${item.repository} ${item.tag}`.toLowerCase().includes(needle))
  }, [items, search])

  const submitPull = (event) => {
    event.preventDefault()
    const reference = pull.trim()
    if (!IMAGE_REF.test(reference)) {
      onNotify('error', t('pullInvalid'))
      return
    }
    setPull('')
    onAction({ kind: 'image', action: 'pull', id: reference }, { focusConsole: true })
  }

  return (
    <div className="dsh-docker-stack">
      <div className="dsh-docker-toolbar">
        <div className="dsh-docker-toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} />
          <form onSubmit={submitPull} className="dsh-docker-toolbar-left" style={{ gap: 6 }}>
            <input
              className="dsh-docker-input"
              style={{ width: 200 }}
              value={pull}
              onChange={(event) => setPull(event.target.value)}
              placeholder={t('pullPlaceholder')}
              aria-label={t('pullPlaceholder')}
              spellCheck="false"
            />
            <Button size="sm" type="submit" disabled={pull.trim() === ''}><IconDownload size={13} /> {t('pull')}</Button>
          </form>
        </div>
        <div className="dsh-docker-toolbar-right">
          <span className="dsh-docker-muted">{filtered.length} / {items.length}</span>
          {!showArchitecture && <span className="dsh-docker-muted">{t('restartForArchitecture')}</span>}
          {features.includes('image-build') && (
            <Button size="sm" onClick={() => setBuildOpen(true)}><IconBuild size={13} /> {t('buildImage')}</Button>
          )}
          <Button size="sm" onClick={list.reload} disabled={list.loading}>{t('refresh')}</Button>
        </div>
      </div>

      {!enabled && items.length === 0 ? (
        <EmptyState icon={<IconAlert size={20} />} title={provider === 'apple-container' ? t('appleSystemStopped') : t('daemonStopped')} text={provider === 'apple-container' ? t('appleSystemStoppedBody') : t('daemonStoppedBody')} />
      ) : list.loading && list.data === null ? (
        <LoadingSkeleton rows={6} />
      ) : list.error !== null && list.data === null ? (
        <ErrorState title={t('listFailed')} text={list.error.message} retryLabel={t('retry')} onRetry={list.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconImage size={20} />} title={search === '' ? t('emptyImages') : t('emptySearch')} text={search === '' ? t('pullPlaceholder') : search} />
      ) : (
        <section className="dsh-docker-card">
          <div className="dsh-docker-table-wrap">
            <table className="dsh-docker-table">
              <thead>
                <tr>
                  <th>{t('repository')}</th>
                  <th>{t('tag')}</th>
                  <th>{t('id')}</th>
                  {showArchitecture && <th>{t('architecture')}</th>}
                  <th className="dsh-docker-col-num">{t('size')}</th>
                  <th>{t('createdSince')}</th>
                  <th className="dsh-docker-col-actions">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const inspectId = provider === 'apple-container' ? item.name : item.id
                  return (
                  <tr key={`${item.id}-${item.name}`}>
                    <td className="dsh-docker-mono dsh-docker-truncate" title={item.repository}>{item.repository}</td>
                    <td className="dsh-docker-mono">{displayValue(item.tag)}</td>
                    <td className="dsh-docker-mono dsh-docker-muted" title={item.id}>{shortId(item.id)}</td>
                    {showArchitecture && <td className="dsh-docker-mono">{displayValue(item.architecture)}</td>}
                    <td className="dsh-docker-col-num">{displayValue(item.size)}</td>
                    <td className="dsh-docker-muted">{displayValue(item.createdSince)}</td>
                    <td className="dsh-docker-col-actions">
                      <span className="dsh-docker-row-actions">
                        {features.includes('run') && item.name !== '<none>' && (
                          <IconButton size="sm" label={t('runFromImage')} onClick={() => onRunContainer(item.name)}>
                            <IconPlay size={14} />
                          </IconButton>
                        )}
                        {features.includes('image-push') && item.name !== '<none>' && (
                          <IconButton size="sm" label={t('pushImage')} onClick={() => onAction({ kind: 'image', action: 'push', id: item.name }, { focusConsole: true })}>
                            <IconUpload size={14} />
                          </IconButton>
                        )}
                        <IconButton size="sm" label={t('inspect')} onClick={() => onInspect('image', inspectId)}>
                          <IconInfo size={14} />
                        </IconButton>
                        <IconButton size="sm" label={t('removeImage')} onClick={() => onAction({ kind: 'image', action: 'delete', id: inspectId })}>
                          <IconTrash size={14} />
                        </IconButton>
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <BuildImageDialog
        open={buildOpen}
        t={t}
        provider={provider}
        cwd={cwd}
        onClose={() => setBuildOpen(false)}
        onSubmit={async (input) => {
          await onAction(input, { focusConsole: true })
        }}
      />
    </div>
  )
}
