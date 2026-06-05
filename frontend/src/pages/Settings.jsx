import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Settings2, Shield, Bot, Mail, Clock, Lock, CheckCircle2, AlertCircle } from 'lucide-react'
import { getSettings, changePassword } from '../api/client'
import { DARK } from '../constants/theme'
import useBreakpoint from '../hooks/useBreakpoint'

const inp = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 13,
  color: DARK.text,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
}

const card = {
  background: DARK.surface,
  border: `1px solid ${DARK.border}`,
  borderRadius: 10,
  padding: '20px',
  marginBottom: 16,
}

function StatusBadge({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 10px', borderRadius: 9999, fontSize: 11, fontWeight: 700,
      background: ok ? 'rgba(30,215,96,0.12)' : 'rgba(255,255,255,0.04)',
      color: ok ? DARK.success : DARK.textDim,
      border: `1px solid ${ok ? 'rgba(30,215,96,0.25)' : DARK.border}`,
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

export default function Settings() {
  const { t } = useTranslation()
  const bp = useBreakpoint()
  const isMobile = bp === 'mobile'

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
    <div style={{ padding: isMobile ? '20px 16px' : '28px 40px', maxWidth: 700 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Settings2 size={20} color={DARK.success} />
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: DARK.text }}>
          {t('settings.title')}
        </h2>
      </div>

      {isLoading && (
        <div style={{ padding: 40, textAlign: 'center', color: DARK.textDim, fontSize: 12 }}>
          {t('loading')}
        </div>
      )}

      {settings && (
        <>
          {/* System Status */}
          <div style={card}>
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
          <div style={card}>
            <SectionTitle
              icon={<Bot size={16} color={DARK.success} />}
              title={t('settings.aiAssistant')}
            />
            <InfoRow label={t('settings.provider')}>
              {providerLabel[settings.llm_provider] || settings.llm_provider}
            </InfoRow>
            {settings.llm_model && (
              <InfoRow label={t('settings.model')}>
                <code style={{ fontSize: 12, background: 'rgba(255,255,255,0.06)', padding: '2px 6px', borderRadius: 4 }}>
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
            <div style={card}>
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
                  style={inp}
                />
                <input
                  type="password"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  placeholder={t('settings.newPassword')}
                  style={inp}
                />
                {pwMsg && (
                  <div style={{
                    fontSize: 12, padding: '6px 10px', borderRadius: 6,
                    background: pwMsg.type === 'success' ? 'rgba(30,215,96,0.1)' : 'rgba(243,114,127,0.1)',
                    color: pwMsg.type === 'success' ? DARK.success : DARK.danger,
                  }}>
                    {pwMsg.text}
                  </div>
                )}
                <button
                  onClick={() => pwMut.mutate()}
                  disabled={!currentPw || !newPw || newPw.length < 4 || pwMut.isPending}
                  style={{
                    alignSelf: 'flex-start',
                    padding: '8px 20px', border: 'none', borderRadius: 9999,
                    background: DARK.warning, color: '#000', fontSize: 12,
                    fontWeight: 700, cursor: 'pointer',
                    opacity: (!currentPw || !newPw || newPw.length < 4) ? 0.4 : 1,
                  }}
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
