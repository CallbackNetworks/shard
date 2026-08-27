import { useQuery } from '@tanstack/react-query'
import { getWorkflowRuleVocabulary } from '../api/client'
import { qk } from '../api/queryKeys'

/**
 * Everything the rule surface needs to render itself, from the one place that defines it.
 *
 * Shared by the editor, the rule cards and the activity feed's execution records: all
 * three name the same triggers, fields and actions, and a second copy of that vocabulary
 * in the frontend is a second place to forget one (ADR-0048, ADR-0049, ADR-0056).
 *
 * `projectId` narrows the label suggestions to that project's labels, which is what a
 * project-scoped rule actually resolves its label names against — offering the whole
 * installation's labels there is offering values that will warn the moment they are saved.
 */
export function useRuleVocabulary(projectId) {
  const { data } = useQuery({
    queryKey: qk.workflowRuleVocabulary(projectId || null),
    queryFn: () => getWorkflowRuleVocabulary(projectId),
    // Not cached forever: labels, events and subscriber counts all change on other pages
    // while this one is open.
    staleTime: 30_000,
  })
  return data
}
