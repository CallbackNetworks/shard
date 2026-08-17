/**
 * The starter prompts, once (ADR-0089).
 *
 * There were two copies — one in the page, one in the floating panel — and they
 * had drifted. "Plan today" and "Analyze Decisions" sent *different* text
 * depending on which surface you clicked, and the panel's Decisions prompt told
 * the assistant to create decision records and tag tasks while the page's only
 * asked it to analyse. Same label, same icon, one of them wrote to the database.
 *
 * The text now lives in the locale files, so the prompt goes out in the language
 * the user is reading — pressing a Chinese-labelled button and getting an English
 * answer was the old behaviour. `promptDecisions` was relabelled to say that it
 * records: the capability is real (`create_decision`, `tag_task_with_decision`),
 * it was only the label that hid it.
 */
export const PROMPT_TEMPLATES = [
  { labelKey: 'assistant.promptSummary',   textKey: 'assistant.promptSummaryText' },
  { labelKey: 'assistant.promptOverdue',   textKey: 'assistant.promptOverdueText' },
  { labelKey: 'assistant.promptWorkload',  textKey: 'assistant.promptWorkloadText' },
  { labelKey: 'assistant.promptRecent',    textKey: 'assistant.promptRecentText' },
  { labelKey: 'assistant.promptPlanToday', textKey: 'assistant.promptPlanTodayText' },
  { labelKey: 'assistant.promptDecisions', textKey: 'assistant.promptDecisionsText' },
]
