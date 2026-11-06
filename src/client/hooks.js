/** Data hooks for the Docker panel. */
import { useCallback, useEffect, useRef, useState } from 'react'

import { cacheClear, cacheGet, cacheSet, isAbortError } from './api.js'

const LIST_TTL = 2000
const STATUS_INTERVAL = 10_000

/**
 * Load one Docker list resource. Manual refreshes bypass the short cache so a
 * click always reflects a fresh command result.
 */
export function useDockerList(api, provider, resource, context, { all = true, refreshToken = 0, enabled = true } = {}) {
  const key = `list:${provider}:${resource}:${context ?? ''}:${all ? 'all' : 'running'}`
  const [state, setState] = useState(() => {
    const cached = cacheGet(key)
    return { data: cached ?? null, error: null, loading: cached === undefined }
  })
  const [localVersion, setLocalVersion] = useState(0)
  const [reloadSignal, setReloadSignal] = useState(0)

  useEffect(() => {
    setState({ data: null, error: null, loading: enabled })
  }, [enabled, key])

  useEffect(() => {
    if (!enabled) {
      setState((current) => (current.data === null && !current.loading && current.error === null ? current : { data: null, error: null, loading: false }))
      return undefined
    }
    const cached = refreshToken === 0 && reloadSignal === 0 ? cacheGet(key) : undefined
    if (cached !== undefined) {
      setState({ data: cached, error: null, loading: false })
      return undefined
    }
    const controller = new AbortController()
    let active = true
    setState((current) => ({ data: current.data, error: null, loading: current.data === null }))
    api.call('list', { provider, resource, context: context ?? undefined, all }, controller.signal).then(
      (value) => {
        if (!active) return
        cacheSet(key, value, LIST_TTL)
        setState({ data: value, error: null, loading: false })
      },
      (error) => {
        if (!active || isAbortError(error)) return
        setState((current) => ({ data: current.data, error, loading: false }))
      },
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [api, provider, key, resource, context, all, enabled, refreshToken, reloadSignal, localVersion])

  const reload = useCallback(() => {
    cacheClear(key)
    setReloadSignal((value) => value + 1)
  }, [key])

  return { ...state, reload }
}

/**
 * Poll Docker status while the panel is visible; keep the last good snapshot
 * when a poll fails so the panel does not flicker during a daemon restart.
 */
export function useDockerStatus(api, provider, context, refreshToken = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: null })
  const [localVersion, setLocalVersion] = useState(0)
  const mounted = useRef(true)

  const load = useCallback(
    async (signal) => {
      try {
        const value = await api.call('status', { provider, context: context ?? undefined }, signal)
        if (!mounted.current || signal?.aborted === true) return
        setState({ data: value, error: null, loading: false, updatedAt: Date.now() })
      } catch (error) {
        if (!mounted.current || isAbortError(error)) return
        setState((current) => ({ ...current, error, loading: false }))
      }
    },
    [api, provider, context],
  )

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    setState({ data: null, error: null, loading: true, updatedAt: null })
  }, [api, provider, context])

  useEffect(() => {
    let controller = new AbortController()
    let timer
    const tick = () => {
      if (document.visibilityState !== 'visible') {
        timer = setTimeout(tick, STATUS_INTERVAL)
        return
      }
      controller.abort()
      controller = new AbortController()
      load(controller.signal)
      timer = setTimeout(tick, STATUS_INTERVAL)
    }
    setState((current) => ({ ...current, loading: current.data === null }))
    tick()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        tick()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      controller.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [load, refreshToken, localVersion])

  const refresh = useCallback(() => {
    cacheClear('list:')
    setLocalVersion((value) => value + 1)
  }, [])

  return { ...state, refresh }
}


/** Load the available providers and their CLI/system availability. */
export function useProviders(api, refreshToken = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const [localVersion, setLocalVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setState((current) => ({ ...current, loading: current.data === null, error: null }))
    api.call('providers', {}, controller.signal).then(
      (value) => {
        if (!active) return
        setState({ data: value, error: null, loading: false })
      },
      (error) => {
        if (!active || isAbortError(error)) return
        setState({ data: null, error, loading: false })
      },
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [api, refreshToken, localVersion])
  const reload = useCallback(() => setLocalVersion((value) => value + 1), [])
  return { ...state, reload }
}
