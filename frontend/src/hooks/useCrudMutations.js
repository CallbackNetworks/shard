import { useMutation, useQueryClient } from '@tanstack/react-query'
import { globalAddToast, useToast } from '../context/ToastContext'

/**
 * useMutation wrapper standardizing the CRUD-page pattern: invalidate the
 * given query keys on success, show a success toast, and surface errors as
 * toasts by default (pages previously swallowed mutation errors silently).
 *
 * `successMessage` may be a string or a function of the mutation result.
 * Pass `onError` to override the default error toast.
 */
export function useInvalidatingMutation({ mutationFn, invalidateKeys = [], successMessage, onSuccess, onError }) {
  const qc = useQueryClient()
  // Fall back to the global toast bridge when rendered outside ToastProvider.
  const addToast = useToast()?.addToast || globalAddToast
  return useMutation({
    mutationFn,
    onSuccess: (...args) => {
      for (const key of invalidateKeys) qc.invalidateQueries({ queryKey: key })
      if (successMessage) {
        addToast(typeof successMessage === 'function' ? successMessage(...args) : successMessage, 'success')
      }
      onSuccess?.(...args)
    },
    onError: (err, ...rest) => {
      if (onError) return onError(err, ...rest)
      addToast(err?.response?.data?.detail || err?.message || 'Request failed', 'error')
    },
  })
}
