/** Compose projects are read-only; the command tab owns lifecycle actions. */
import { useMemo, useState } from 'react'

import { Button, CopyButton, EmptyState, ErrorState, LoadingSkeleton, SearchInput, displayValue } from '../components.jsx'
import { useDockerList } from '../hooks.js'
import { IconAlert, IconCompose } from '../icons.jsx'

function configList(value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function composeCommand(project) {
  const files = configList(project.configFiles)
  return files.length === 0 ? null : `docker compose -f ${JSON.stringify(files[0])}`
}

export default function ComposeTab({ t, api, provider, context, status, refreshToken }) {
  const [search, setSearch] = useState('')
  const enabled = status?.daemon?.state === 'running'
  const list = useDockerList(api, provider, 'compose', context, { refreshToken, enabled })
  const items = list.data?.items ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle === '' ? items : items.filter((item) => `${item.name} ${item.status} ${item.configFiles}`.toLowerCase().includes(needle))
  }, [items, search])

  return (
    <div className="dsh-docker-stack">
      <div className="dsh-docker-toolbar">
        <div className="dsh-docker-toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} />
          <span className="dsh-docker-muted">{t('composeReadOnly')}</span>
        </div>
        <div className="dsh-docker-toolbar-right">
          <span className="dsh-docker-muted">{filtered.length} / {items.length}</span>
          <Button size="sm" onClick={list.reload} disabled={list.loading}>{t('refresh')}</Button>
        </div>
      </div>
      {!enabled && items.length === 0 ? (
        <EmptyState icon={<IconAlert size={20} />} title={t('daemonStopped')} text={t('daemonStoppedBody')} />
      ) : list.loading && list.data === null ? (
        <LoadingSkeleton rows={5} />
      ) : list.error !== null && list.data === null ? (
        <ErrorState title={t('listFailed')} text={list.error.message} retryLabel={t('retry')} onRetry={list.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconCompose size={20} />} title={search === '' ? t('emptyCompose') : t('emptySearch')} text={search === '' ? t('composeReadOnly') : search} />
      ) : (
        <section className="dsh-docker-card">
          <div className="dsh-docker-table-wrap">
            <table className="dsh-docker-table">
              <thead>
                <tr>
                  <th>{t('project')}</th>
                  <th>{t('status')}</th>
                  <th>{t('configFiles')}</th>
                  <th className="dsh-docker-col-actions">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const base = composeCommand(item)
                  return (
                    <tr key={item.name}>
                      <td className="dsh-docker-row-title">{item.name}</td>
                      <td>{displayValue(item.status)}</td>
                      <td>
                        <div className="dsh-docker-chips">
                          {configList(item.configFiles).map((file) => (
                            <span key={file} className="dsh-docker-chip dsh-docker-chip-code" title={file}>{file}</span>
                          ))}
                        </div>
                      </td>
                      <td className="dsh-docker-col-actions">
                        {base !== null ? (
                          <span className="dsh-docker-row-actions">
                            <CopyButton text={`${base} up -d`} label="up -d" copiedLabel={t('copied')} className="dsh-docker-btn dsh-docker-sm" />
                            <CopyButton text={`${base} down`} label="down" copiedLabel={t('copied')} className="dsh-docker-btn dsh-docker-sm" />
                          </span>
                        ) : (
                          <span className="dsh-docker-muted">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
