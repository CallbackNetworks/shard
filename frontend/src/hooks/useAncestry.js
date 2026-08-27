import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getAncestry } from '../api/client'
import { qk } from '../api/queryKeys'

// `GET /graph/ancestry` is batched because its callers are lists (ADR-0094). This is
// the client half of that: a page hands it every id it is about to draw and gets one
// map back, then passes each row its own entry. Without it a list row that wanted to
// say where it lives would have to mount its own query, which is one request per row.
//
// The server cuts the batch at 200 ids; the cap is repeated here so the ids that get
// dropped are the ones this page chose to drop, not an arbitrary tail of a URL.
const MAX_IDS = 200

export default function useAncestry(ids, scope) {
  const list = useMemo(() => [...new Set((ids || []).filter(Boolean))].sort().slice(0, MAX_IDS), [ids])
  const { data } = useQuery({
    queryKey: qk.ancestry(scope, list.join(',')),
    queryFn: () => getAncestry(list),
    enabled: list.length > 0,
    staleTime: 30000,
  })
  return data || {}
}
