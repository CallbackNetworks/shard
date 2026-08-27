import { describe, it, expect, vi, beforeEach } from 'vitest'
import { qk } from '../../api/queryKeys'

const mockInvalidateQueries = vi.fn()
const mockAddToast = vi.fn()
let capturedConfig

vi.mock('@tanstack/react-query', () => ({
  useMutation: (config) => { capturedConfig = config; return config },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({ addToast: mockAddToast }),
  globalAddToast: vi.fn(),
}))

import { useInvalidatingMutation } from '../useCrudMutations'

describe('useInvalidatingMutation', () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear()
    mockAddToast.mockClear()
    capturedConfig = undefined
  })

  it('invalidates every key and toasts success', () => {
    const onSuccess = vi.fn()
    useInvalidatingMutation({
      mutationFn: vi.fn(),
      invalidateKeys: [['goals'], ['projects']],
      successMessage: 'Saved',
      onSuccess,
    })
    capturedConfig.onSuccess('result')
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: qk.goals() })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: qk.projects() })
    expect(mockAddToast).toHaveBeenCalledWith('Saved', 'success')
    expect(onSuccess).toHaveBeenCalledWith('result')
  })

  it('supports successMessage as a function of the result', () => {
    useInvalidatingMutation({ mutationFn: vi.fn(), successMessage: (data) => `Made ${data.id}` })
    capturedConfig.onSuccess({ id: 7 })
    expect(mockAddToast).toHaveBeenCalledWith('Made 7', 'success')
  })

  it('toasts API error detail by default', () => {
    useInvalidatingMutation({ mutationFn: vi.fn() })
    capturedConfig.onError({ response: { data: { detail: 'Nope' } } })
    expect(mockAddToast).toHaveBeenCalledWith('Nope', 'error')
  })

  it('falls back to error message, then generic text', () => {
    useInvalidatingMutation({ mutationFn: vi.fn() })
    capturedConfig.onError(new Error('boom'))
    expect(mockAddToast).toHaveBeenCalledWith('boom', 'error')
    capturedConfig.onError({})
    expect(mockAddToast).toHaveBeenCalledWith('Request failed', 'error')
  })

  it('custom onError overrides the default toast', () => {
    const onError = vi.fn()
    useInvalidatingMutation({ mutationFn: vi.fn(), onError })
    capturedConfig.onError(new Error('boom'))
    expect(onError).toHaveBeenCalled()
    expect(mockAddToast).not.toHaveBeenCalled()
  })
})
