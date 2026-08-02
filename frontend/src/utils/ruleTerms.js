/**
 * How a rule is read out loud (ADR-0058).
 *
 * The engine names things for itself: `changed_field`, `title_contains`, `set_priority`,
 * `in_progress`. Those are the strings the API takes and the strings a rule is stored
 * with, so they stay exactly that on the wire — but a page that prints them verbatim asks
 * the reader to parse identifiers, and `if changed_field eq in_progress` is not a sentence
 * anybody speaks. Every identifier the *product* coined is turned into words here, with
 * the raw key kept underneath as the option's value.
 *
 * What is deliberately left alone: anything the user wrote. A label called `needs_review`,
 * an event they invented, a comment body, an assignee's name. Showing those back in
 * different words than they were typed is worse than an underscore — the string on screen
 * would no longer be the string to search for. `spec.vocabulary`, served per value slot,
 * draws that line, so a condition field added on the server lands on the correct side of
 * it with nothing to change here.
 */

/** `changed_field` -> `Changed Field`, `node.created` -> `Node Created`. */
export const humanizeTerm = (value) =>
  String(value ?? '').replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

// Translated only where the derived name misleads; everything else stays derived, so a
// trigger, field or action added on the server shows up readable with nothing to
// translate first.
// Without a catalogue at hand the derived name *is* the answer, so a caller that has no
// `t` still gets words rather than a crash.
const derived = (t, ns, key) => {
  if (!key) return ''
  const fallback = humanizeTerm(key)
  return typeof t === 'function' ? t(`rules.${ns}.${key}`, { defaultValue: fallback }) : fallback
}

export const triggerLabel = (trigger, t) => derived(t, 'triggerName', trigger)
export const fieldLabel = (field, t) => derived(t, 'field', field)
export const opLabel = (op, t) => derived(t, 'op', op)
export const actionLabel = (type, t) => derived(t, 'action', type)

/** A value, shown as words only when the engine is the one who named it. */
export const valueLabel = (value, spec) =>
  (spec?.vocabulary ? humanizeTerm(value) : String(value ?? ''))

/** `Set Priority "High"` / `Add Label "needs_review"` — the action, without its outcome. */
export const actionPhrase = (type, value, t, specs) => {
  const label = actionLabel(type, t)
  const shown = valueLabel(value, specs?.[type])
  return shown ? `${label} "${shown}"` : label
}

// `title_contains` is the one field whose name already carries its verb, and the engine
// reads its op as nothing but negation (`rules_engine`: `op != "neq"`). Printing the stored
// op beside it reads "Title Contains contains" at best, and "Title Contains is" — a match
// the engine would never make — at worst. So the clause states what actually happens.
const titleClause = (op, t) =>
  op === 'neq'
    ? (typeof t === 'function' ? t('rules.clause.titleExcludes', { defaultValue: 'Title does not contain' }) : 'Title does not contain')
    : (typeof t === 'function' ? t('rules.clause.titleContains', { defaultValue: 'Title contains' }) : 'Title contains')

/** `Changed Field is "Status"` — one condition, read as a clause. */
export const conditionPhrase = (cond, t, specs) => {
  const shown = valueLabel(cond.value, specs?.[cond.field])
  if (cond.field === 'title_contains') return `${titleClause(cond.op, t)} "${shown}"`
  return `${fieldLabel(cond.field, t)} ${opLabel(cond.op, t)} "${shown}"`
}
