import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings2, Shield, Bot, Lock, CheckCircle2, AlertCircle, SlidersHorizontal, PanelLeft, ChevronUp, ChevronDown, Eye, EyeOff, Check, Bell, Clock, DatabaseBackup, Download } from 'lucide-react'
import { getSettings, changePassword, setPreference, updateSystemSettings, getBackupStatus, runBackup, exportBackup, downloadBackupFile } from '../api/client'
import { DARK } from '../constants/theme'
import { useTheme } from '../context/ThemeContext'
import { NAV_GROUPS, orderGroupItems } from '../constants/nav'
import {
  useUiPrefs, setUiPref, PROJECT_VIEWS, TASK_PRIORITIES,
  ACCENT_PRESETS, UI_SCALES, TIME_FORMATS, WEEK_STARTS, TIMESTAMP_STYLES,
  LIST_DENSITIES, REFRESH_RATES,
} from '../utils/uiPrefs'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function saveBlob(response, fallbackName) {
  const disposition = response.headers?.['content-disposition'] || ''
  const match = disposition.match(/filename="?([^";]+)"?/)
  const url = URL.createObjectURL(response.data)
  const a = document.createElement('a')
  a.href = url
  a.download = match?.[1] || fallbackName
  a.click()
  URL.revokeObjectURL(url)
}

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
  const qc = useQueryClient()

  const uiPrefs = useUiPrefs()

  const persistPref = (key, value) => {
    const next = setUiPref(key, value)
    // Best-effort mirror to backend for cross-device sync.
    setPreference('user-preferences', next).catch(() => {})
  }

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng)
    setPreference('user-preferences', { ...uiPrefs, language: lng }).catch(() => {})
  }

  const toggleSidebarItem = (to) => {
    const hidden = uiPrefs.sidebarHidden.includes(to)
      ? uiPrefs.sidebarHidden.filter(x => x !== to)
      : [...uiPrefs.sidebarHidden, to]
    persistPref('sidebarHidden', hidden)
  }

  const moveSidebarItem = (groupItems, index, dir) => {
    const ordered = orderGroupItems(groupItems, uiPrefs.sidebarOrder)
    const target = index + dir
    if (target < 0 || target >= ordered.length) return
    const swapped = [...ordered]
    ;[swapped[index], swapped[target]] = [swapped[target], swapped[index]]
    // Rebuild a full flat order across all groups, replacing this group's order.
    const fullOrder = NAV_GROUPS.flatMap(g =>
      g.items === groupItems
        ? swapped.map(it => it.to)
        : orderGroupItems(g.items, uiPrefs.sidebarOrder).map(it => it.to)
    )
    persistPref('sidebarOrder', fullOrder)
  }

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: getSettings,
  })

  const systemMut = useMutation({
    mutationFn: updateSystemSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  })

  const { data: backupStatus } = useQuery({
    queryKey: ['backup-status'],
    queryFn: getBackupStatus,
    staleTime: 30000,
  })

  const backupMut = useMutation({
    mutationFn: runBackup,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backup-status'] }),
  })

  const [exporting, setExporting] = useState(false)
  const handleExport = async () => {
    setExporting(true)
    try {
      saveBlob(await exportBackup(), 'shard-backup.zip')
    } finally {
      setExporting(false)
    }
  }

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
    <div className="kt-page">
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

      <div className="kt-settings-grid">
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
        <ControlRow label={t('settings.accent')} hint={t('settings.accentHint')}>
          <div style={{ display: 'flex', gap: 8 }}>
            {ACCENT_PRESETS.map(a => {
              const active = uiPrefs.accent === a.key
              return (
                <button
                  key={a.key}
                  onClick={() => persistPref('accent', a.key)}
                  aria-label={a.key}
                  title={a.key}
                  style={{
                    width: 24, height: 24, cursor: 'pointer', padding: 0,
                    background: a.main, border: `2px solid ${active ? DARK.text : 'transparent'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {active && <Check size={13} color="#000" strokeWidth={3} />}
                </button>
              )
            })}
          </div>
        </ControlRow>
        <ControlRow label={t('settings.uiScale')} hint={t('settings.uiScaleHint')}>
          <Segmented
            value={uiPrefs.uiScale}
            onChange={v => persistPref('uiScale', v)}
            options={UI_SCALES.map(s => ({ value: s.value, label: t(s.labelKey) }))}
          />
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

      {/* Date & time display */}
      <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle
          icon={<Clock size={16} color="#818cf8" />}
          title={t('settings.dateTime')}
        />
        <ControlRow label={t('settings.timeFormat')} hint={t('settings.timeFormatHint')}>
          <Segmented
            value={uiPrefs.timeFormat}
            onChange={v => persistPref('timeFormat', v)}
            options={TIME_FORMATS.map(f => ({ value: f, label: t(`settings.timeFormat.${f}`) }))}
          />
        </ControlRow>
        <ControlRow label={t('settings.weekStart')} hint={t('settings.weekStartHint')}>
          <Segmented
            value={uiPrefs.weekStart}
            onChange={v => persistPref('weekStart', v)}
            options={WEEK_STARTS.map(w => ({ value: w, label: t(`settings.weekStart.${w}`) }))}
          />
        </ControlRow>
        <ControlRow label={t('settings.timestampStyle')} hint={t('settings.timestampStyleHint')}>
          <Segmented
            value={uiPrefs.timestampStyle}
            onChange={v => persistPref('timestampStyle', v)}
            options={TIMESTAMP_STYLES.map(st => ({ value: st, label: t(`settings.timestampStyle.${st}`) }))}
          />
        </ControlRow>
      </div>

      {/* Lists & live updates */}
      <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle
          icon={<SlidersHorizontal size={16} color="#818cf8" />}
          title={t('settings.listsRefresh')}
        />
        <ControlRow label={t('settings.listDensity')} hint={t('settings.listDensityHint')}>
          <Segmented
            value={uiPrefs.listDensity}
            onChange={v => persistPref('listDensity', v)}
            options={LIST_DENSITIES.map(d => ({ value: d, label: t(`settings.listDensity.${d}`) }))}
          />
        </ControlRow>
        <ControlRow label={t('settings.refreshRate')} hint={t('settings.refreshRateHint')}>
          <Segmented
            value={uiPrefs.refreshRate}
            onChange={v => persistPref('refreshRate', v)}
            options={REFRESH_RATES.map(r => ({ value: r, label: t(`settings.refreshRate.${r}`) }))}
          />
        </ControlRow>
      </div>

      {/* Sidebar modules: show/hide + reorder */}
      <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
        <SectionTitle
          icon={<PanelLeft size={16} color="#818cf8" />}
          title={t('settings.sidebarModules')}
        />
        <p style={{ margin: '0 0 12px', fontSize: 12, color: DARK.textDim }}>
          {t('settings.sidebarModulesHint')}
        </p>
        {NAV_GROUPS.map(group => {
          const ordered = orderGroupItems(group.items, uiPrefs.sidebarOrder)
          return (
            <div key={group.label} style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                {group.label}
              </div>
              {ordered.map((item, i) => {
                const isHidden = uiPrefs.sidebarHidden.includes(item.to)
                const Icon = item.icon
                return (
                  <div
                    key={item.to}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', borderBottom: `1px solid ${DARK.border}`,
                      opacity: isHidden ? 0.5 : 1,
                    }}
                  >
                    <Icon size={15} color={DARK.textMid} />
                    <span style={{ flex: 1, fontSize: 13, color: DARK.text }}>{t(item.labelKey)}</span>
                    <button
                      onClick={() => moveSidebarItem(group.items, i, -1)}
                      disabled={i === 0}
                      aria-label="Move up"
                      style={{ opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? 'default' : 'pointer', background: 'none', border: 'none', color: DARK.textMid, padding: 4 }}
                    >
                      <ChevronUp size={15} />
                    </button>
                    <button
                      onClick={() => moveSidebarItem(group.items, i, 1)}
                      disabled={i === ordered.length - 1}
                      aria-label="Move down"
                      style={{ opacity: i === ordered.length - 1 ? 0.3 : 1, cursor: i === ordered.length - 1 ? 'default' : 'pointer', background: 'none', border: 'none', color: DARK.textMid, padding: 4 }}
                    >
                      <ChevronDown size={15} />
                    </button>
                    <button
                      onClick={() => !item.locked && toggleSidebarItem(item.to)}
                      disabled={item.locked}
                      aria-label={isHidden ? 'Show' : 'Hide'}
                      title={item.locked ? t('settings.moduleLocked') : (isHidden ? t('settings.show') : t('settings.hide'))}
                      style={{ cursor: item.locked ? 'default' : 'pointer', background: 'none', border: 'none', color: item.locked ? DARK.textDim : (isHidden ? DARK.textDim : DARK.success), padding: 4 }}
                    >
                      {isHidden ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })}
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
          </div>

          {/* Notifications & Reminders (backend-persisted) */}
          <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
            <SectionTitle
              icon={<Bell size={16} color={DARK.warning} />}
              title={t('settings.notifications')}
            />
            <ControlRow label={t('settings.summaryHour')} hint={t('settings.summaryHourHint')}>
              <select
                value={settings.summary_hour}
                onChange={e => systemMut.mutate({ summary_hour: Number(e.target.value) })}
                className="kt-input"
                style={{ width: 'auto', minWidth: 110 }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>
                ))}
              </select>
            </ControlRow>
            <ControlRow label={t('settings.dueSoonWindow')} hint={t('settings.dueSoonWindowHint')}>
              <Segmented
                value={settings.due_soon_window_hours}
                onChange={v => systemMut.mutate({ due_soon_window_hours: v })}
                options={[6, 12, 24, 48].map(h => ({ value: h, label: t('settings.hoursShort', { n: h }) }))}
              />
            </ControlRow>
          </div>

          {/* Backup */}
          <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
            <SectionTitle
              icon={<DatabaseBackup size={16} color={DARK.info} />}
              title={t('settings.backup')}
            />
            <ControlRow label={t('settings.backupAuto')} hint={t('settings.backupAutoHint')}>
              <Segmented
                value={settings.backup_enabled ? 'on' : 'off'}
                onChange={v => systemMut.mutate({ backup_enabled: v === 'on' ? 1 : 0 })}
                options={[
                  { value: 'off', label: t('settings.off') },
                  { value: 'on', label: t('settings.on') },
                ]}
              />
            </ControlRow>
            <ControlRow label={t('settings.backupHour')} hint={t('settings.backupHourHint')}>
              <select
                value={settings.backup_hour}
                onChange={e => systemMut.mutate({ backup_hour: Number(e.target.value) })}
                className="kt-input"
                style={{ width: 'auto', minWidth: 110 }}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00 UTC</option>
                ))}
              </select>
            </ControlRow>
            <ControlRow label={t('settings.backupKeep')} hint={t('settings.backupKeepHint')}>
              <Segmented
                value={settings.backup_keep}
                onChange={v => systemMut.mutate({ backup_keep: v })}
                options={[3, 7, 14, 30].map(n => ({ value: n, label: String(n) }))}
              />
            </ControlRow>
            <div style={{ display: 'flex', gap: 10, margin: '14px 0' }}>
              <button
                onClick={() => backupMut.mutate()}
                disabled={backupMut.isPending}
                className="kt-btn kt-btn-primary"
              >
                {backupMut.isPending ? t('loading') : t('settings.backupNow')}
              </button>
              <button onClick={handleExport} disabled={exporting} className="kt-btn">
                <Download size={12} /> {exporting ? t('loading') : t('settings.backupDownload')}
              </button>
            </div>
            {backupStatus?.backups?.length > 0 ? (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: DARK.textDim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  {t('settings.backupExisting')}
                </div>
                {backupStatus.backups.map(b => (
                  <div key={b.filename} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 0', borderBottom: `1px solid ${DARK.border}`, fontSize: 12,
                  }}>
                    <code style={{ flex: 1, color: DARK.textMid }}>{b.filename}</code>
                    <span style={{ color: DARK.textDim }}>{formatBytes(b.size_bytes)}</span>
                    <button
                      onClick={async () => saveBlob(await downloadBackupFile(b.filename), b.filename)}
                      aria-label={t('settings.backupDownload')}
                      title={t('settings.backupDownload')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 4 }}
                    >
                      <Download size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: DARK.textDim }}>{t('settings.backupNone')}</div>
            )}
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
    </div>
  )
}
