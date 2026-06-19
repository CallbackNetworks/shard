import { useState, useEffect, useCallback, useRef } from 'react'

const DB_NAME = 'shard-offline'
const STORE_NAME = 'pending-actions'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function enqueueAction(action) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add({
      ...action,
      timestamp: Date.now(),
    })
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function getPendingActions() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function clearAction(id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export default function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const syncingRef = useRef(false)

  useEffect(() => {
    const goOnline = () => setIsOnline(true)
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  const refreshCount = useCallback(async () => {
    try {
      const actions = await getPendingActions()
      setPendingCount(actions.length)
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    refreshCount()
  }, [refreshCount])

  const queueAction = useCallback(async (type, url, data) => {
    await enqueueAction({ type, url, data })
    await refreshCount()
  }, [refreshCount])

  const syncPending = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return
    syncingRef.current = true
    setSyncing(true)
    try {
      const actions = await getPendingActions()
      for (const action of actions) {
        try {
          const token = localStorage.getItem('auth_token')
          const headers = { 'Content-Type': 'application/json' }
          if (token) headers['Authorization'] = `Bearer ${token}`

          const opts = { method: action.type, headers }
          if (action.data && action.type !== 'GET' && action.type !== 'DELETE') {
            opts.body = JSON.stringify(action.data)
          }
          const res = await fetch(action.url, opts)
          if (res.ok || res.status === 404) {
            await clearAction(action.id)
          }
        } catch {
          break
        }
      }
    } finally {
      syncingRef.current = false
      setSyncing(false)
      await refreshCount()
    }
  }, [refreshCount])

  useEffect(() => {
    if (isOnline && pendingCount > 0) {
      syncPending()
    }
  }, [isOnline, pendingCount, syncPending])

  return { isOnline, pendingCount, syncing, queueAction, syncPending }
}
