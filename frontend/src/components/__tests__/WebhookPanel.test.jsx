import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WebhookPanel from '../WebhookPanel'
import en from '../../i18n/en.json'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  invalidateQueries: vi.fn(),
  mutate: vi.fn(),
  getWebhookConfig: vi.fn(),
  rotateWebhookSecret: vi.fn(() => Promise.resolve()),
}))

vi.mock('react-i18next', () => ({
  // The real catalogue, not the fallback: what matters is the wording that ships.
  useTranslation: () => ({ t: (key, opts) => en[key] ?? (opts && 'defaultValue' in opts ? opts.defaultValue : key) }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (...args) => mocks.useQuery(...args),
  useMutation: (opts) => ({ mutate: () => { mocks.mutate(); opts.mutationFn() }, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}))

vi.mock('../../api/client', () => ({
  getWebhookConfig: mocks.getWebhookConfig,
  rotateWebhookSecret: mocks.rotateWebhookSecret,
}))

const SECRET = 'a'.repeat(64)
const CONFIG = { callback_token: 'tok-123', secret: SECRET, path: '/webhook/callback/tok-123' }

describe('WebhookPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.useQuery.mockReturnValue({ data: CONFIG, isLoading: false })
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } })
  })

  it('shows the URL and the key together', () => {
    // One without the other configures nothing: an unsigned callback is rejected.
    render(<WebhookPanel taskId="t1" />)

    expect(screen.getByText(/\/webhook\/callback\/tok-123$/)).toBeTruthy()
    expect(screen.getByText(en['webhookPanel.secret'])).toBeTruthy()
  })

  it('keeps the secret masked until asked', () => {
    render(<WebhookPanel taskId="t1" />)

    expect(screen.queryByText(SECRET)).toBeNull()

    fireEvent.click(screen.getByTitle(en['webhookPanel.reveal']))

    expect(screen.getByText(SECRET)).toBeTruthy()
  })

  it('copies the real secret even while it is masked', () => {
    // Copying is the normal path — a person pasting into CI settings has no reason to
    // read the key first, and making them reveal it would only put it on screen.
    render(<WebhookPanel taskId="t1" />)

    const [, secretCopy] = screen.getAllByTitle(en['copy'])
    fireEvent.click(secretCopy)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SECRET)
  })

  it('asks the server for the secret once, and only while it is open', () => {
    render(<WebhookPanel taskId="t1" />)

    const [opts] = mocks.useQuery.mock.calls[0]
    expect(opts.queryKey).toEqual(['webhook-config', 't1'])
    // Dropped from the cache the moment the panel closes, so a credential is not left
    // sitting in the query cache of every screen that ever showed a task list.
    expect(opts.gcTime).toBe(0)
    // And never re-fetched underneath the user: realtime sync invalidates every query on
    // any graph change, and each read of this one writes an activity row.
    expect(opts.staleTime).toBe(Infinity)
  })

  it('rotates and re-reads', () => {
    render(<WebhookPanel taskId="t1" />)

    fireEvent.click(screen.getByTitle(en['webhookPanel.rotate']))

    expect(mocks.rotateWebhookSecret).toHaveBeenCalledWith('t1')
  })

  it('says nothing while the secret is still in flight', () => {
    mocks.useQuery.mockReturnValue({ data: undefined, isLoading: true })

    render(<WebhookPanel taskId="t1" />)

    expect(screen.getByText(en['webhookPanel.loading'])).toBeTruthy()
  })
})
