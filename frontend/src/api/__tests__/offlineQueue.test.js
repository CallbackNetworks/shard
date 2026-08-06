/**
 * The queue has a producer (ADR-0062).
 *
 * `OfflineIndicator.test.jsx` mocks `useOfflineSync` wholesale, so it was green while the
 * queue had no way of ever receiving anything: it pinned what the badge *displays* given a
 * pending count, never that a pending count could arise. These tests go the other way and
 * leave the display alone — they check that a write failing for want of a network ends up
 * stored, and that writes which should not be stored are not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(() => Promise.resolve()), toast: vi.fn() }))

vi.mock('../offlineQueue', () => ({
  enqueue: mocks.enqueue,
  subscribe: vi.fn(() => () => {}),
  getPending: vi.fn(() => Promise.resolve([])),
  drop: vi.fn(),
  count: vi.fn(() => Promise.resolve(0)),
}))

vi.mock('../../context/ToastContext', () => ({ globalAddToast: mocks.toast }))

const api = (await import('../client')).default

/** The rejection handler axios would run — the real one, taken off the instance. */
const reject = api.interceptors.response.handlers[0].rejected

const networkError = (config) => Object.assign(new Error('Network Error'), { config })

function setOnline(value) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

describe('offline write queueing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setOnline(false)
  })
  afterEach(() => setOnline(true))

  it('queues a write that failed because there was no network', async () => {
    const err = networkError({ method: 'patch', url: '/nodes/n1', baseURL: '/api', data: '{"title":"x"}' })

    await expect(reject(err)).rejects.toBe(err)

    expect(mocks.enqueue).toHaveBeenCalledWith({
      method: 'PATCH',
      // The full path, so replay does not depend on the instance's baseURL later.
      url: '/api/nodes/n1',
      data: { title: 'x' },
    })
    expect(err.queuedOffline).toBe(true)
  })

  it('tells the user, instead of letting the change disappear silently', async () => {
    await reject(networkError({ method: 'post', url: '/nodes', baseURL: '/api', data: '{}' })).catch(() => {})

    expect(mocks.toast).toHaveBeenCalledWith(expect.stringMatching(/queued/i), 'info')
  })

  it('does not queue reads — there is nothing to replay', async () => {
    await reject(networkError({ method: 'get', url: '/projects', baseURL: '/api' })).catch(() => {})

    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('does not queue a file upload', async () => {
    // Replaying a file chosen in a previous session is not something this can honestly
    // promise, so the upload is left to fail and say so.
    const form = new FormData()
    await reject(networkError({ method: 'post', url: '/attachments', baseURL: '/api', data: form })).catch(() => {})

    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('does not queue a failure the server answered', async () => {
    // A 422 is a refusal, not a lost connection. Replaying it would only be refused again.
    const err = Object.assign(new Error('bad'), {
      config: { method: 'post', url: '/nodes', baseURL: '/api', data: '{}' },
      response: { status: 422, data: { detail: 'nope' } },
    })
    await reject(err).catch(() => {})

    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('does not queue a replayed action again', async () => {
    // Otherwise a replay that fails mid-drain would grow the queue it is draining.
    const err = networkError({ method: 'post', url: '/api/nodes', baseURL: '', data: '{}', _replay: true })
    await reject(err).catch(() => {})

    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('reports the failure when the browser thinks it is online', async () => {
    // A dead server or a captive portal: nothing to wait for, so say so rather than
    // silently bank the change.
    setOnline(true)
    await reject(networkError({ method: 'post', url: '/nodes', baseURL: '/api', data: '{}' })).catch(() => {})

    expect(mocks.enqueue).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith(expect.any(String), 'error')
  })
})
