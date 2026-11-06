/** Containers tab with search, state filter, and per-row actions. */
import { useMemo, useState } from 'react'

import {
  Button,
  Chips,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingSkeleton,
  SearchInput,
  StateLabel,
} from '../components.jsx'
import { useDockerList } from '../hooks.js'
import { IconAlert, IconAttach, IconBox, IconExec, IconInfo, IconPlay, IconRestart, IconSparkles, IconStop, IconTerminal, IconTrash } from '../icons.jsx'

export default function ContainersTab({ t, api, provider, context, status, refreshToken, features, onAction, onAttach, onRunContainer, onAskAI, canAskAI, onInspect }) {
  const [all, setAll] = useState(true)
  const [search, setSearch] = useState('')
  const enabled = status?.daemon?.state === 'running'
  const list = useDockerList(api, provider, 'containers', context, { all, refreshToken, enabled })
  const items = list.data?.items ?? []
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return items
    return items.filter((item) =>
      [item.name, item.image, item.id, item.status, item.ports.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    )
  }, [items, search])

  const act = (action, item, focusConsole = false, follow = false) => {
    onAction({ kind: 'container', action, id: item.id, follow }, { focusConsole })
  }

  return (
    <div className="dsh-docker-stack">
      <div className="dsh-docker-toolbar">
        <div className="dsh-docker-toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} />
          <div className="dsh-docker-seg" role="group" aria-label={t('status')}>
            <button type="button" aria-pressed={all} onClick={() => setAll(true)}>{t('all')}</button>
            <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>{t('running')}</button>
          </div>
        </div>
        <div className="dsh-docker-toolbar-right">
          <span className="dsh-docker-muted">{filtered.length} / {items.length}</span>
          {features.includes('run') ? <Button size="sm" variant="primary" onClick={() => onRunContainer()}>{t('runContainer')}</Button> : <span className="dsh-docker-muted">{t('restartFeatures')}</span>}
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
        <EmptyState icon={<IconBox size={20} />} title={search === '' ? t('emptyContainers') : t('emptySearch')} text={search === '' ? undefined : search} />
      ) : (
        <section className="dsh-docker-card">
          <div className="dsh-docker-table-wrap">
            <table className="dsh-docker-table">
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  <th>{t('image')}</th>
                  <th>{t('status')}</th>
                  <th>{t('ports')}</th>
                  <th>{t('created')}</th>
                  <th className="dsh-docker-col-actions">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <button type="button" className="dsh-docker-row-title" style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }} onClick={() => onInspect('container', item.id)}>
                        {item.name || item.id}
                      </button>
                      {item.id !== item.name && <div className="dsh-docker-mono dsh-docker-muted">{item.id}</div>}
                    </td>
                    <td className="dsh-docker-mono dsh-docker-truncate" title={item.image}>{item.image}</td>
                    <td><StateLabel state={item.state} t={t} /></td>
                    <td><Chips values={item.ports.slice(0, 2)} mono /></td>
                    <td className="dsh-docker-muted">{item.runningFor || item.createdAt || '—'}</td>
                    <td className="dsh-docker-col-actions">
                      <span className="dsh-docker-row-actions">
                        {item.state === 'running' ? (
                          <IconButton size="sm" label={t('stopContainer')} onClick={() => act('stop', item)}>
                            <IconStop size={14} />
                          </IconButton>
                        ) : (
                          <IconButton size="sm" label={t('startContainer')} onClick={() => act('start', item)}>
                            <IconPlay size={14} />
                          </IconButton>
                        )}
                        {provider === 'docker' && (
                          <IconButton size="sm" label={t('restartContainer')} onClick={() => act('restart', item)}>
                            <IconRestart size={14} />
                          </IconButton>
                        )}
                        {canAskAI && (
                          <IconButton
                            size="sm"
                            label={item.state === 'running' ? t('askAi') : t('diagnose')}
                            onClick={() => onAskAI(item, item.state === 'running' ? 'ask' : 'diagnose')}
                          >
                            <IconSparkles size={14} />
                          </IconButton>
                        )}
                        {features.includes('exec') && item.state === 'running' && (
                          <IconButton size="sm" label={t('exec')} onClick={() => onAttach(item, 'exec')}>
                            <IconExec size={14} />
                          </IconButton>
                        )}
                        {features.includes('attach') && item.state === 'running' && (
                          <IconButton size="sm" label={t('attach')} onClick={() => onAttach(item)}>
                            <IconAttach size={14} />
                          </IconButton>
                        )}
                        <IconButton size="sm" label={t('logs')} onClick={() => act('logs', item, true)}>
                          <IconTerminal size={14} />
                        </IconButton>
                        <IconButton size="sm" label={t('followLogs')} onClick={() => act('logs', item, true, true)}>
                          <IconTerminal size={14} style={{ transform: 'scaleX(-1)' }} />
                        </IconButton>
                        <IconButton size="sm" label={t('inspect')} onClick={() => onInspect('container', item.id)}>
                          <IconInfo size={14} />
                        </IconButton>
                        <IconButton size="sm" label={t('remove')} onClick={() => act('delete', item)}>
                          <IconTrash size={14} />
                        </IconButton>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
