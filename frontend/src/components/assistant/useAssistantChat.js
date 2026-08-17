import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAssistantConversations, getAssistantConversation,
  createAssistantConversation, deleteAssistantConversation,
  streamAssistantMessage,
} from '../../api/client'

/**
 * One assistant conversation, whatever is drawing it (ADR-0089).
 *
 * The page and the floating panel each carried their own copy of this: the same
 * two queries, the same two mutations, and the same hand-rolled SSE reader. Two
 * copies of a streaming loop is two places for a partial frame or a missed
 * `done` event to be handled differently, and neither invalidated quite the same
 * query keys. The surfaces differ in layout only; this is the behaviour.
 */
export default function useAssistantChat({ enabled = true } = {}) {
  const qc = useQueryClient()
  const [convId, setConvId] = useState(null)
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamEvents, setStreamEvents] = useState([])
  const [search, setSearch] = useState('')
  const endRef = useRef(null)

  const { data: conversations = [] } = useQuery({
    queryKey: ['assistant-conversations', search],
    queryFn: () => getAssistantConversations(search || undefined),
    enabled,
    staleTime: 5000,
  })

  const { data: conversation } = useQuery({
    queryKey: ['assistant-conv', convId],
    queryFn: () => getAssistantConversation(convId),
    enabled: !!convId,
    staleTime: 0,
  })

  const createMut = useMutation({
    mutationFn: createAssistantConversation,
    onSuccess: (conv) => {
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
      setConvId(conv.id)
    },
  })

  const deleteMut = useMutation({
    mutationFn: deleteAssistantConversation,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
      setConvId(current => (current === id ? null : current))
    },
  })

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages, streamEvents])

  const send = useCallback(async (text, convOverride) => {
    const cid = convOverride || convId
    const message = (text ?? input).trim()
    if (!message || streaming || !cid) return
    setInput('')
    setStreaming(true)
    setStreamEvents([])
    try {
      await streamAssistantMessage(cid, message, (event) => {
        setStreamEvents(prev => [...prev, event])
        if (event.type === 'done') {
          qc.invalidateQueries({ queryKey: ['assistant-conv', cid] })
          qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
        }
      })
    } catch (err) {
      setStreamEvents(prev => [...prev, { type: 'error', message: String(err?.message || err) }])
    } finally {
      setStreaming(false)
    }
  }, [convId, input, streaming, qc])

  /** Start a fresh conversation and send `text` into it in one step. */
  const startWith = useCallback(async (text) => {
    if (streaming) return null
    const conv = await createAssistantConversation()
    qc.invalidateQueries({ queryKey: ['assistant-conversations'] })
    setConvId(conv.id)
    send(text, conv.id)
    return conv
  }, [streaming, qc, send])

  const isDone = streamEvents.some(e => e.type === 'done')

  return {
    conversations, conversation, convId, setConvId,
    input, setInput,
    search, setSearch,
    streaming,
    streamEvents,
    // Keep the streaming bubble mounted until `done` arrives, so the text does
    // not blank out between the last chunk and the refetched message.
    showStreaming: streaming || (streamEvents.length > 0 && !isDone),
    messages: conversation?.messages || [],
    endRef,
    send,
    startWith,
    createConversation: () => createMut.mutate(),
    deleteConversation: (id) => deleteMut.mutate(id),
  }
}
