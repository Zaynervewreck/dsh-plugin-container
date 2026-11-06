/** Docker overview: runtime, counts, recent containers, disk, quick commands. */
import { useMemo } from 'react'

import {
  Button,
  Chips,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Spinner,
  StateLabel,
  displayValue,
  formatBytes,
  formatTime,
} from '../components.jsx'
import { useDockerList } from '../hooks.js'
import { IconBox, IconImage, IconPlay, IconRestart, IconStop, IconTerminal } from '../icons.jsx'

function Stat({ label, value, detail }) {
  return (
    <div className="dsh-docker-stat">
      <div className="dsh-docker-stat-label">{label}</div>
      <div className="dsh-docker-stat-value">{value}</div>
      {detail !== undefined && <div className="dsh-docker-stat-detail">{detail}</div>}
    </div>
  )
}

function RuntimeCard({ t, provider, status, imageCount, volumeCount, networkCount, onRuntime, busy }) {
  const runtime = status.runtime
  const details = runtime?.details ?? {}
  const isApple = provider === 'apple-container'
  const rows = (isApple ? [
    [t('providerLabel'), t('providerApple')],
    [t('systemService'), details.status],
    [t('client'), status.client?.version],
    [t('server'), status.server?.version],
    [t('containers'), status.server?.containers],
    [t('images'), imageCount],
    [t('volumes'), volumeCount],
    [t('networks'), networkCount],
    [t('cpus'), status.server?.ncpu !== undefined ? String(status.server.ncpu) : undefined],
    [t('memory'), status.server?.memTotal !== undefined ? formatBytes(status.server.memTotal) : undefined],
  ] : [
    [t('endpoint'), status.context?.endpoint],
    [t('profile'), runtime?.profile],
    [t('driver'), runtime?.driver ?? details.driver],
    [t('arch'), runtime?.arch ?? details.arch],
    [t('mountType'), runtime?.mountType ?? details.mountType],
    [t('kubernetes'), runtime?.kubernetes === undefined ? undefined : runtime.kubernetes ? t('yes') : t('no')],
    [t('cpus'), runtime?.cpus !== undefined ? String(runtime.cpus) : undefined],
    [t('memory'), runtime?.memory !== undefined ? formatBytes(runtime.memory) : undefined],
    [t('disk'), runtime?.disk !== undefined ? formatBytes(runtime.disk) : undefined],
  ]).filter(([, value]) => value !== undefined && value !== null && value !== '')
  return (
    <section className="dsh-docker-card">
      <div className="dsh-docker-card-head">
        <div>
          <h2 className="dsh-docker-card-title">{t('runtime')}</h2>
          <p className="dsh-docker-card-sub">{runtime?.kind ?? ''}</p>
        </div>
        <span className="dsh-docker-status" data-state={runtime?.running ? 'running' : 'stopped'}>
          <span className="dsh-docker-dot" />
          {runtime?.running ? t('statusRunning') : t('statusStopped')}
        </span>
      </div>
      <div className="dsh-docker-card-body">
        <div className="dsh-docker-runtime-head">
          <span className="dsh-docker-mark" style={{ width: 34, height: 34 }}><IconBox size={19} /></span>
          <div>
            <div className="dsh-docker-runtime-name">{runtime?.label ?? t('unknownRuntime')}</div>
            <div className="dsh-docker-muted">{isApple ? 'container · per-container VM' : runtime?.kind === 'colima' ? `colima · profile ${runtime.profile ?? 'default'}` : (runtime?.kind ?? '')}</div>
          </div>
        </div>
        <div className="dsh-docker-kv">
          {rows.map(([key, value]) => (
            <div key={key} className="dsh-docker-kv-row" style={{ display: 'contents' }}>
              <div className="dsh-docker-kv-key">{key}</div>
              <div className="dsh-docker-kv-value">{displayValue(value)}</div>
            </div>
          ))}
        </div>
        <div className="dsh-docker-middle" style={{ marginTop: 14 }}>
          {runtime?.canStart === true && (
            <Button size="sm" variant="primary" onClick={() => onRuntime('start')} disabled={busy}>
              {busy ? <Spinner size={13} /> : <IconPlay size={13} />} {t('start')}
            </Button>
          )}
          {runtime?.canStop === true && (
            <Button size="sm" onClick={() => onRuntime('stop')} disabled={busy}>
              <IconStop size={13} /> {t('stop')}
            </Button>
          )}
          {runtime?.canRestart === true && (
            <Button size="sm" onClick={() => onRuntime('restart')} disabled={busy}>
              <IconRestart size={13} /> {t('restart')}
            </Button>
          )}
          {runtime?.canStart !== true && runtime?.canStop !== true && runtime?.canRestart !== true && (
            <span className="dsh-docker-muted">{status.capabilities?.enableRuntimeControl === false ? t('runtimeControlDisabled') : runtime?.error ?? t('remoteHint')}</span>
          )}
        </div>
      </div>
    </section>
  )
}

function RecentContainers({ t, list, onOpenTab, onInspect }) {
  if (list.loading && list.data === null) return <LoadingSkeleton rows={4} />
  if (list.error !== null && list.data === null) {
    return <ErrorState title={t('listFailed')} text={list.error.message} retryLabel={t('retry')} onRetry={list.reload} />
  }
  const items = (list.data?.items ?? []).slice(0, 5)
  if (items.length === 0) {
    return <EmptyState icon={<IconBox size={19} />} title={t('emptyContainers')} />
  }
  return (
    <div className="dsh-docker-table-wrap">
      <table className="dsh-docker-table">
        <thead>
          <tr>
            <th>{t('name')}</th>
            <th>{t('image')}</th>
            <th>{t('status')}</th>
            <th>{t('ports')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} onClick={() => onInspect('container', item.id)} style={{ cursor: 'pointer' }}>
              <td><span className="dsh-docker-row-title">{item.name || item.id}</span></td>
              <td className="dsh-docker-mono dsh-docker-truncate">{item.image}</td>
              <td><StateLabel state={item.state} t={t} /></td>
              <td><Chips values={item.ports.slice(0, 2)} mono /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
        <Button size="sm" variant="ghost" onClick={() => onOpenTab('containers')}>{t('viewAll')}</Button>
      </div>
    </div>
  )
}

function DiskCard({ t, list }) {
  if (list.loading && list.data === null) return <LoadingSkeleton rows={3} />
  if (list.error !== null && list.data === null) return <div className="dsh-docker-muted" style={{ padding: 16 }}>{list.error.message}</div>
  const items = list.data?.items ?? []
  if (items.length === 0) return <div className="dsh-docker-muted" style={{ padding: 16 }}>{t('noDiskData')}</div>
  return (
    <div className="dsh-docker-table-wrap">
      <table className="dsh-docker-table">
        <thead>
          <tr>
            <th>{t('status')}</th>
            <th className="dsh-docker-col-num">{t('size')}</th>
            <th className="dsh-docker-col-num">Reclaimable</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.type}>
              <td>{item.type}</td>
              <td className="dsh-docker-col-num">{displayValue(item.size)}</td>
              <td className="dsh-docker-col-num">{displayValue(item.reclaimable)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function OverviewTab({ t, api, provider, context, status, refreshToken, onRuntime, onOpenTab, onInspect, onQuickCommand, runState }) {
  const enabled = status?.daemon?.state === 'running'
  const containers = useDockerList(api, provider, 'containers', context, { all: true, refreshToken, enabled })
  const images = useDockerList(api, provider, 'images', context, { refreshToken, enabled })
  const volumes = useDockerList(api, provider, 'volumes', context, { refreshToken, enabled })
  const networks = useDockerList(api, provider, 'networks', context, { refreshToken, enabled })
  const disk = useDockerList(api, provider, 'disk', context, { refreshToken, enabled })
  const busy = runState?.run !== null && runState?.run !== undefined && (runState.run.status === 'running' || runState.run.status === 'cancelling')
  const server = status?.server
  const isApple = provider === 'apple-container'
  const quick = isApple ? ['ls -a', 'image ls', 'volume ls', 'network ls', 'system df', 'system version'] : ['ps -a', 'images', 'volume ls', 'network ls', 'compose ls', 'system df', 'info', 'version']
  const commandPrefix = isApple ? 'container' : 'docker'
  const recent = useMemo(() => (containers.data?.items ?? []).slice(0, 5), [containers.data])

  const volumeCount = volumes.data?.items?.length
  const networkCount = networks.data?.items?.length
  const imageCount = images.data?.items?.length ?? server?.images

  return (
    <div className="dsh-docker-stack">
      <div className="dsh-docker-stats">
        <Stat label={t('runningContainers')} value={server?.containersRunning ?? '—'} detail={isApple ? t('providerApple') : context ?? t('noContext')} />
        <Stat label={t('stoppedContainers')} value={server?.containersStopped ?? '—'} />
        <Stat label={t('imageCount')} value={imageCount ?? '—'} />
        <Stat label={t('volumeCount')} value={volumeCount ?? '—'} />
        <Stat label={t('networkCount')} value={networkCount ?? '—'} />
        <Stat
          label={t('server')}
          value={provider === 'apple-container' ? status?.client?.version ?? server?.version ?? '—' : server?.version ?? status?.client?.version ?? '—'}
          detail={server?.ncpu !== undefined ? `${server.ncpu} CPU · ${formatBytes(server.memTotal)}` : undefined}
        />
      </div>

      <div className="dsh-docker-grid-2">
        <RuntimeCard t={t} provider={provider} status={status} imageCount={imageCount} volumeCount={volumeCount} networkCount={networkCount} onRuntime={onRuntime} busy={busy} />
        <section className="dsh-docker-card">
          <div className="dsh-docker-card-head">
            <div>
              <h2 className="dsh-docker-card-title">{t('quickCommands')}</h2>
              <p className="dsh-docker-card-sub">{t('terminal')}</p>
            </div>
            <IconTerminal size={16} className="dsh-docker-muted" />
          </div>
          <div className="dsh-docker-card-body">
            <div className="dsh-docker-chip-row">
              {quick.map((command) => (
                <button key={command} type="button" className="dsh-docker-quick" onClick={() => onQuickCommand(`${commandPrefix} ${command}`)}>
                  {command}
                </button>
              ))}
            </div>
            <div className="dsh-docker-divider" />
            <div className="dsh-docker-kv">
              <div className="dsh-docker-kv-key">{t('client')}</div>
              <div className="dsh-docker-kv-value">{status?.client?.version ?? '—'} {status?.cli?.path ? <span className="dsh-docker-mono dsh-docker-muted"> · {status.cli.path}</span> : null}</div>
              <div className="dsh-docker-kv-key">{isApple ? t('providerLabel') : t('context')}</div>
              <div className="dsh-docker-kv-value">{isApple ? t('providerApple') : context ?? status?.context?.selected ?? status?.context?.current ?? t('noContext')}</div>
              <div className="dsh-docker-kv-key">{t('lastUpdated')}</div>
              <div className="dsh-docker-kv-value">{formatTime(status?.fetchedAt)}</div>
            </div>
          </div>
        </section>
      </div>

      <div className="dsh-docker-grid-2">
        <section className="dsh-docker-card">
          <div className="dsh-docker-card-head">
            <div>
              <h2 className="dsh-docker-card-title">{t('recentContainers')}</h2>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onOpenTab('containers')}>{t('viewAll')}</Button>
          </div>
          <div className="dsh-docker-card-body dsh-docker-flush" style={{ paddingTop: 10 }}>
            <RecentContainers t={t} list={{ ...containers, data: containers.data ?? { items: recent } }} onOpenTab={onOpenTab} onInspect={onInspect} />
          </div>
        </section>
        <section className="dsh-docker-card">
          <div className="dsh-docker-card-head">
            <div>
              <h2 className="dsh-docker-card-title">{t('disk')}</h2>
              <p className="dsh-docker-card-sub">{commandPrefix} system df</p>
            </div>
            <IconImage size={16} className="dsh-docker-muted" />
          </div>
          <div className="dsh-docker-card-body dsh-docker-flush" style={{ paddingTop: 10 }}>
            <DiskCard t={t} list={disk} />
          </div>
        </section>
      </div>
    </div>
  )
}
