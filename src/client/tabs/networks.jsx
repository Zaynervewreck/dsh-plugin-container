/** Networks tab. */
import { useMemo, useState } from 'react'

import { Button, EmptyState, ErrorState, IconButton, LoadingSkeleton, SearchInput, displayValue } from '../components.jsx'
import { useDockerList } from '../hooks.js'
import { IconAlert, IconInfo, IconNetwork, IconTrash } from '../icons.jsx'

const BUILTIN = new Set(['bridge', 'host', 'none'])

export default function NetworksTab({ t, api, provider, context, status, refreshToken, onAction, onInspect }) {
  const [search, setSearch] = useState('')
  const enabled = status?.daemon?.state === 'running'
  const list = useDockerList(api, provider, 'networks', context, { refreshToken, enabled })
  const items = list.data?.items ?? []
  const builtin = provider === 'apple-container' ? new Set(['default']) : BUILTIN
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle === '' ? items : items.filter((item) => `${item.name} ${item.driver} ${item.scope} ${item.id}`.toLowerCase().includes(needle))
  }, [items, search])

  return (
    <div className="dsh-docker-stack">
      <div className="dsh-docker-toolbar">
        <div className="dsh-docker-toolbar-left">
          <SearchInput value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} />
        </div>
        <div className="dsh-docker-toolbar-right">
          <span className="dsh-docker-muted">{filtered.length} / {items.length}</span>
          <Button size="sm" onClick={list.reload} disabled={list.loading}>{t('refresh')}</Button>
        </div>
      </div>
      {!enabled && items.length === 0 ? (
        <EmptyState icon={<IconAlert size={20} />} title={provider === 'apple-container' ? t('appleSystemStopped') : t('daemonStopped')} text={provider === 'apple-container' ? t('appleSystemStoppedBody') : t('daemonStoppedBody')} />
      ) : list.loading && list.data === null ? (
        <LoadingSkeleton rows={5} />
      ) : list.error !== null && list.data === null ? (
        <ErrorState title={t('listFailed')} text={list.error.message} retryLabel={t('retry')} onRetry={list.reload} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconNetwork size={20} />} title={search === '' ? t('emptyNetworks') : t('emptySearch')} text={search === '' ? undefined : search} />
      ) : (
        <section className="dsh-docker-card">
          <div className="dsh-docker-table-wrap">
            <table className="dsh-docker-table">
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  <th>{t('driver')}</th>
                  <th>{t('scope')}</th>
                  <th>IPv4</th>
                  <th>IPv6</th>
                  <th>{t('internal')}</th>
                  <th className="dsh-docker-col-actions">{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="dsh-docker-row-title">{item.name}</div>
                      <div className="dsh-docker-mono dsh-docker-muted">{item.id}</div>
                    </td>
                    <td>{displayValue(item.driver)}</td>
                    <td>{displayValue(item.scope)}</td>
                    <td>{displayValue(item.ipv4)}</td>
                    <td>{displayValue(item.ipv6)}</td>
                    <td>{displayValue(item.internal)}</td>
                    <td className="dsh-docker-col-actions">
                      <span className="dsh-docker-row-actions">
                        <IconButton size="sm" label={t('inspect')} onClick={() => onInspect('network', item.id)}>
                          <IconInfo size={14} />
                        </IconButton>
                        <IconButton
                          size="sm"
                          label={t('removeNetwork')}
                          disabled={builtin.has(item.name)}
                          onClick={() => onAction({ kind: 'network', action: 'delete', id: item.name })}
                        >
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
