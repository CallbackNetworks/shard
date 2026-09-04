import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getNodeTypes } from '../api/client'
import { qk } from '../api/queryKeys'

/**
 * The node-type registry, keyed by type key.
 *
 * Four pages had built this same map from the same query with the same staleTime,
 * which is fine until a fifth caller picks a different key or forgets the memo and
 * hands `nodeHref` a fresh Map on every render. The registry is small, rarely
 * changes and is already shared through React Query's cache, so the request is not
 * repeated — only the `new Map` was.
 */
export function useNodeTypeMap() {
  const { data: nodeTypes = [] } = useQuery({
    queryKey: qk.nodeTypes(),
    queryFn: getNodeTypes,
    staleTime: 300000,
  })
  return useMemo(() => new Map(nodeTypes.map(nt => [nt.key, nt])), [nodeTypes])
}

export default useNodeTypeMap
