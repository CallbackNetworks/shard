/**
 * Writes that could not be sent, kept until they can (ADR-0062).
 *
 * This machinery already existed inside `useOfflineSync`, complete and working, with one
 * thing missing: nothing ever called the function that put anything into it. The queue was
 * therefore always empty, the pending count always zero, and a mutation made while offline
 * vanished without even an error toast — while a badge at the bottom of the screen said
 * "Offline", implying it was being looked after.
 *
 * It lives here rather than in the hook because the producer is the axios interceptor, not
 * a component. That is deliberate: the interceptor is the one place every write already
 * passes through, so queueing needs no list of which mutations to cover — a list that would
 * fall behind the next feature, which is exactly how the original went unnoticed.
 */

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

const listeners = new Set()

/** Tell the indicator the queue changed, so the count is live without polling. */
function notify() {
  listeners.forEach(fn => { try { fn() } catch { /* a bad listener must not stop the rest */ } })
}

export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export async function enqueue(action) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).add({ ...action, timestamp: Date.now() })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  notify()
}

export async function getPending() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    // Insertion order. Replay has to follow it: a comment on a task created in the same
    // offline stretch is meaningless if it arrives first.
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.id - b.id))
    req.onerror = () => reject(req.error)
  })
}

export async function drop(id) {
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
  notify()
}

export async function count() {
  return (await getPending()).length
}
