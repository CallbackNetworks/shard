import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Settings2, Shield, Bot, Lock, CheckCircle2, AlertCircle, SlidersHorizontal } from 'lucide-react'
import { getSettings, changePassword, setPreference } from '../api/client'
import { DARK } from '../constants/theme'
import { useTheme } from '../context/ThemeContext'
import { getUiPrefs, setUiPref, PROJECT_VIEWS, TASK_PRIORITIES } from '../utils/uiPrefs'

function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', fontSize: 11, fontWeight: 700,
      background: ok ? 'rgba(250,204,21,0.12)' : 'rgba(255,255,255,0.04)',
      color: ok ? DARK.success : DARK.textDim,
      border: `1px solid ${ok ? 'rgba(250,204,21,0.25)' : DARK.border}`,
    }}>
      {ok ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
      {label}
    </span>
  )
}

function SectionTitle({ icon, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
      {icon}
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: DARK.text }}>{title}</h3>
    </div>
  )
}

function InfoRow({ label, children }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: `1px solid ${DARK.border}`,
    }}>
      <span style={{ fontSize: 13, color: DARK.textMid }}>{label}</span>
      <span style={{ fontSize: 13, color: DARK.text, fontWeight: 600 }}>{children}</span>
    </div>
  )
}

function ControlRow({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16,
      padding: '12px 0', borderBottom: `1px solid ${DARK.border}`,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, color: DARK.textMid }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: DARK.textDim }}>{hint}</span>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  )
}

function Segmented({ options, value, onChange }) {
  return (
    <div style={{ display: 'inline-flex', border: `1px solid ${DARK.border}`, overflow: 'hidden' }}>
      {options.map((opt, i) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            style={{
              padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${DARK.border}`,
              background: active ? 'rgba(129,140,248,0.18)' : 'transparent',
              color: active ? DARK.text : DARK.textDim,
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export default function Settings() {
  const { t, i18n } = useTranslation()
  const { mode, setMode } = useTheme()

  const [uiPrefs, setUiPrefsState] = useState(() => getUiPrefs())

  const persistPref = (key, value) => {
    const next = setUiPref(key, value)
    setUiPrefsState(next)
    // Best-effort mirror to backend for cross-device sync.
    setPreference('user-preferences', next).catch(() => {})
  }

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng)
    setPreference('user-preferences', { ...uiPrefs, language: lng }).catch(() => {})
  }

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  const pwMut = useMutation({
    mutationFn: () => changePassword({ current_password: currentPw, new_password: newPw }),
    onSuccess: () => {
      setPwMsg({ type: 'success', text: t('settings.passwordChanged') })
      setCurrentPw('')
      setNewPw('')
      localStorage.removeItem('auth_token')
      setTimeout(() => { window.location.href = '/login' }, 1500)
    },
    onError: (err) => {
      setPwMsg({ type: 'error', text: err.response?.data?.detail || 'Error' })
    },
  })

  const providerLabel = {
    claude: 'Claude (Anthropic)',
    openai: 'OpenAI',
    stub: 'Not configured',
  }

  return (
    <div className="kt-page" style={{ maxWidth: 760, margin: 0 }}>
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('settings.title')}</h1>
        </div>
        <Settings2 size={22} color={DARK.success} />
      </div>

      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: DARK.textDim, fontSize: 12 }}>
          {t('loading')}
        </div>
      )}

      {/* Preferences (client-side, always available) */}
      <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle
          icon={<SlidersHorizontal size={16} color="#818cf8" />}
          title={t('settings.preferences')}
        />
        <ControlRow label={t('settings.theme')} hint={t('settings.themeHint')}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'light', label: t('settings.themeLight') },
            ]}
          />
        </ControlRow>
        <ControlRow label={t('settings.language')} hint={t('settings.languageHint')}>
          <Segmented
            value={i18n.language}
            onChange={changeLanguage}
            options={[
              { value: 'en', label: 'English' },
              { value: 'zh-TW', label: '繁體中文' },
            ]}
          />
        </ControlRow>
        <ControlRow label={t('settings.defaultView')} hint={t('settings.defaultViewHint')}>
          <select
            value={uiPrefs.defaultView}
            onChange={e => persistPref('defaultView', e.target.value)}
            className="kt-input"
            style={{ width: 'auto', minWidth: 140 }}
          >
            {PROJECT_VIEWS.map(v => (
              <option key={v} value={v}>{t(`settings.view.${v}`)}</option>
            ))}
          </select>
        </ControlRow>
        <ControlRow label={t('settings.defaultPriority')} hint={t('settings.defaultPriorityHint')}>
          <select
            value={uiPrefs.defaultPriority}
            onChange={e => persistPref('defaultPriority', e.target.value)}
            className="kt-input"
            style={{ width: 'auto', minWidth: 140 }}
          >
            {TASK_PRIORITIES.map(p => (
              <option key={p} value={p}>{t(p)}</option>
            ))}
          </select>
        </ControlRow>
        <ControlRow label={t('settings.reduceMotion')} hint={t('settings.reduceMotionHint')}>
          <Segmented
            value={uiPrefs.reduceMotion ? 'on' : 'off'}
            onChange={v => persistPref('reduceMotion', v === 'on')}
            options={[
              { value: 'off', label: t('settings.off') },
              { value: 'on', label: t('settings.on') },
            ]}
          />
        </ControlRow>
      </div>

      {settings && (
        <>
          {/* System Status */}
          <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
            <SectionTitle
              icon={<Shield size={16} color={DARK.info} />}
              title={t('settings.systemStatus')}
            />
            <InfoRow label={t('settings.authentication')}>
              <StatusBadge ok={settings.auth_enabled} label={settings.auth_enabled ? t('settings.enabled') : t('settings.disabled')} />
            </InfoRow>
            <InfoRow label={t('settings.email')}>
              <StatusBadge ok={settings.smtp_configured} label={settings.smtp_configured ? t('settings.configured') : t('settings.notConfigured')} />
            </InfoRow>
            <InfoRow label={t('settings.summaryHour')}>
              {settings.summary_hour}:00 UTC
            </InfoRow>
          </div>

          {/* AI Assistant */}
          <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
            <SectionTitle
              icon={<Bot size={16} color={DARK.success} />}
              title={t('settings.aiAssistant')}
            />
            <InfoRow label={t('settings.provider')}>
              {providerLabel[settings.llm_provider] || settings.llm_provider}
            </InfoRow>
            {settings.llm_model && (
              <InfoRow label={t('settings.model')}>
                <code style={{ fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '2px 6px' }}>
                  {settings.llm_model}
                </code>
              </InfoRow>
            )}
            <InfoRow label="MCP Transport">
              {settings.mcp_transport}
            </InfoRow>
          </div>

          {/* Password Change */}
          {settings.auth_enabled && (
            <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
              <SectionTitle
                icon={<Lock size={16} color={DARK.warning} />}
                title={t('settings.changePassword')}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  type="password"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  placeholder={t('settings.currentPassword')}
                  className="kt-input"
                />
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder={t('settings.newPassword')}
                  className="kt-input"
                />
                {pwMsg && (
                  <div style={{
                    fontSize: 12, padding: '6px 10px',
                    background: pwMsg.type === 'success' ? 'rgba(250,204,21,0.1)' : 'rgba(250,204,21,0.12)',
                    color: pwMsg.type === 'success' ? DARK.success : DARK.danger,
                  }}>
                    {pwMsg.text}
                  </div>
                )}
                <button
                  onClick={() => pwMut.mutate()}
                  disabled={!currentPw || !newPw || newPw.length < 4 || pwMut.isPending}
                  className="kt-btn kt-btn-primary"
                  style={{ alignSelf: 'flex-start', opacity: (!currentPw || !newPw || newPw.length < 4) ? 0.4 : 1 }}
                >
                  {pwMut.isPending ? t('loading') : t('settings.updatePassword')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
