import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PROMPT_TEMPLATES } from '../prompts'
import en from '../../../i18n/en.json'
import zh from '../../../i18n/zh-TW.json'

/**
 * The assistant has one implementation and two layouts (ADR-0089).
 *
 * It used to have two of everything: two axios instances with their own auth
 * interceptors, two copies of the four conversation calls, two SSE readers, two
 * `ToolBlock`/`MessageBubble` pairs, and two `PROMPT_TEMPLATES` — which had
 * already drifted. "Plan today" and the decisions prompt sent *different text*
 * depending on which surface you clicked, and one of them told the assistant to
 * write decision records while the other only asked it to analyse. Nothing
 * failed; both returned 200 and streamed a reply, which is what a drifted
 * duplicate always does (ADR-0070).
 */

const read = (p) => readFileSync(resolve(__dirname, '../../..', p), 'utf8')
const SURFACES = ['pages/Assistant.jsx', 'components/AssistantPanel.jsx']

describe('both assistant surfaces sit on the shared implementation', () => {
  it.each(SURFACES)('%s uses useAssistantChat', (path) => {
    expect(read(path)).toMatch(/useAssistantChat/)
  })

  it.each(SURFACES)('%s builds no axios instance of its own', (path) => {
    const source = read(path)
    expect(source).not.toMatch(/axios\.create/)
    expect(source, 'auth headers belong to the one api client').not.toMatch(/auth_token/)
  })

  it.each(SURFACES)('%s reads no SSE stream of its own', (path) => {
    const source = read(path)
    expect(source).not.toMatch(/getReader\(|TextDecoder/)
  })

  it.each(SURFACES)('%s declares no prompt list of its own', (path) => {
    expect(read(path)).not.toMatch(/PROMPT_TEMPLATES\s*=/)
  })

  it.each(SURFACES)('%s renders assistant replies through the shared bubble', (path) => {
    expect(read(path)).toMatch(/MessageBubble/)
  })
})

describe('the starter prompts', () => {
  it('resolve to real text in both locales', () => {
    for (const { labelKey, textKey } of PROMPT_TEMPLATES) {
      expect(en[labelKey], `${labelKey} missing from en`).toBeTruthy()
      expect(en[textKey], `${textKey} missing from en`).toBeTruthy()
      expect(zh[labelKey], `${labelKey} missing from zh-TW`).toBeTruthy()
      expect(zh[textKey], `${textKey} missing from zh-TW`).toBeTruthy()
    }
  })

  it('are sent in the reader\'s language, not always English', () => {
    for (const { textKey } of PROMPT_TEMPLATES) {
      expect(zh[textKey], `${textKey} is still the English text`).not.toBe(en[textKey])
    }
  })
})
