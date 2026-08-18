import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Bot, Eye, EyeOff } from 'lucide-react'
import { updateLlmSettings } from '../../api/client'
import { DARK } from '../../constants/theme'
import { ControlRow, InfoRow, SectionTitle, Segmented, StatusBadge } from './primitives'

const PROVIDERS = ['stub', 'claude', 'openai']

/** Assistant provider/model/API key card (ADR-0096). Self-contained: owns its draft
 *  state and mutation, syncs from the fetched settings only while nothing is unsaved. */
export default function LlmSettingsPanel({ settings }) {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const [provider, setProvider] = useState(settings.llm_provider)
  const [model, setModel] = useState(settings.llm_model || '')
  const [baseUrl, setBaseUrl] = useState(settings.llm_base_url || '')
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState(null)
  const [modelCheck, setModelCheck] = useState(null)

  useEffect(() => {
    if (dirty) return
    setProvider(settings.llm_provider)
    setModel(settings.llm_model || '')
    setBaseUrl(settings.llm_base_url || '')
  }, [settings.llm_provider, settings.llm_model, settings.llm_base_url, dirty])

  const mut = useMutation({
    mutationFn: updateLlmSettings,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setApiKeyDraft('')
      setClearKey(false)
      setDirty(false)
      setMessage({ type: 'success', text: t('settings.llmSaved') })
      setModelCheck(data?.model_check ?? null)
    },
    onError: (err) => {
      setMessage({ type: 'error', text: err.response?.data?.detail || 'Error' })
      setModelCheck(null)
    },
  })

  const providerLabel = {
    claude: 'Claude (Anthropic)',
    openai: 'OpenAI',
    stub: t('settings.llmNotConfigured'),
  }

  const handleSave = () => {
    const payload = { provider, model, base_url: baseUrl }
    if (clearKey) payload.api_key = ''
    else if (apiKeyDraft) payload.api_key = apiKeyDraft
    setMessage(null)
    setModelCheck(null)
    mut.mutate(payload)
  }

  return (
    <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
      <SectionTitle icon={<Bot size={16} color={DARK.success} />} title={t('settings.aiAssistant')} />

      <ControlRow label={t('settings.provider')} hint={t('settings.llmProviderHint')}>
        <Segmented
          value={provider}
          onChange={v => { setProvider(v); setDirty(true) }}
          options={PROVIDERS.map(p => ({ value: p, label: providerLabel[p] }))}
        />
      </ControlRow>

      <ControlRow label={t('settings.model')} hint={t('settings.llmModelHint')}>
        <input
          value={model}
          onChange={e => { setModel(e.target.value); setDirty(true); setModelCheck(null) }}
          placeholder={t('settings.llmModelPlaceholder')}
          className="kt-input"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </ControlRow>

      {modelCheck?.checked && modelCheck.ok === true && (
        <div style={{ fontSize: 12, color: DARK.success, marginTop: -8, marginBottom: 12 }}>
          {t('settings.llmModelVerified')}
        </div>
      )}
      {modelCheck?.checked && modelCheck.ok === false && (
        <div style={{ fontSize: 12, color: DARK.warning, marginTop: -8, marginBottom: 12 }}>
          {t('settings.llmModelNotFoundPrefix')}: {modelCheck.detail}
        </div>
      )}
      {modelCheck && !modelCheck.checked && modelCheck.detail && (
        <div style={{ fontSize: 12, color: DARK.textDim, marginTop: -8, marginBottom: 12 }}>
          {t('settings.llmModelUnverifiedPrefix')}: {modelCheck.detail}
        </div>
      )}

      <ControlRow label={t('settings.llmBaseUrl')} hint={t('settings.llmBaseUrlHint')}>
        <input
          value={baseUrl}
          onChange={e => { setBaseUrl(e.target.value); setDirty(true) }}
          placeholder={t('settings.llmBaseUrlPlaceholder')}
          className="kt-input"
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        />
      </ControlRow>

      <ControlRow label={t('settings.llmApiKey')} hint={t('settings.llmApiKeyHint')}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type={showKey ? 'text' : 'password'}
            value={apiKeyDraft}
            onChange={e => { setApiKeyDraft(e.target.value); setClearKey(false); setDirty(true) }}
            placeholder={
              clearKey
                ? t('settings.llmApiKeyWillClear')
                : settings.llm_api_key_configured
                  ? t('settings.llmApiKeyConfiguredPlaceholder')
                  : t('settings.llmApiKeyPlaceholder')
            }
            className="kt-input"
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => setShowKey(v => !v)}
            className="kt-btn"
            aria-label={showKey ? t('settings.hide') : t('settings.show')}
            title={showKey ? t('settings.hide') : t('settings.show')}
          >
            {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          {settings.llm_api_key_configured && !clearKey && (
            <button type="button" onClick={() => { setClearKey(true); setApiKeyDraft(''); setDirty(true) }} className="kt-btn">
              {t('settings.llmApiKeyClear')}
            </button>
          )}
        </div>
      </ControlRow>

      <InfoRow label={t('settings.llmApiKeyStatus')}>
        <StatusBadge
          ok={settings.llm_api_key_configured}
          label={settings.llm_api_key_configured ? t('settings.configured') : t('settings.notConfigured')}
        />
      </InfoRow>

      <InfoRow label={t('settings.llmUsageTitle', { days: settings.llm_usage_window_days ?? 30 })}>
        <span style={{ fontFamily: 'monospace', fontSize: 12 }}>
          {t('settings.llmUsageValue', {
            input: (settings.llm_usage_input_tokens ?? 0).toLocaleString(),
            output: (settings.llm_usage_output_tokens ?? 0).toLocaleString(),
          })}
        </span>
      </InfoRow>

      {message && (
        <div style={{ fontSize: 12, marginTop: 8, color: message.type === 'error' ? DARK.danger : DARK.success }}>
          {message.text}
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={!dirty || mut.isPending}
        className="kt-btn kt-btn-primary"
        style={{ marginTop: 12, opacity: !dirty ? 0.4 : 1 }}
      >
        {mut.isPending ? t('loading') : t('save')}
      </button>
    </div>
  )
}
