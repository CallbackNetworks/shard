import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit3, Trash2, Link2, Unlink, ExternalLink, Share2, RefreshCw, Check, Shield, Clock, Eye } from 'lucide-react'
import {
  getIdentities, createIdentity, updateIdentity, deleteIdentity,
  getProjects, linkProjectIdentity, unlinkProjectIdentity, rotateShareToken,
  setSharePin, clearSharePin, setShareExpiry, getShareViewCount,
} from '../api/client'
import { BRAND, INSET_SHADOW, SHADOW_SM, DARK } from '../constants/theme'
import EmptyState from '../components/shared/EmptyState'

const COLORS = [
  '#5e6ad2', '#22c55e', '#ef4444', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
  '#14b8a6', '#a855f7', '#e11d48', '#0ea5e9',
]

const inputStyle = {
  border: 'none',
  boxShadow: INSET_SHADOW,
  borderRadius: 4, padding: '8px 12px',
  fontSize: 14, background: DARK.elevated, color: DARK.text,
  boxSizing: 'border-box', display: 'block', width: '100%', marginTop: 4, outline: 'none',
}

function IdentityForm({ initial, onSave, onCancel }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial || { name: '', color: '#5e6ad2', description: '', avatar: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div style={{ background: DARK.surface, borderRadius: 8, padding: 20, marginBottom: 16, boxShadow: SHADOW_SM }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: DARK.text, flex: '0 0 auto' }}>
          {t('identities.avatar')}
          <input value={form.avatar} onChange={e => set('avatar', e.target.value)}
            placeholder={t('identities.avatarPlaceholder')}
            maxLength={2}
            style={{ ...inputStyle, width: 48, textAlign: 'center', fontSize: 16 }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 700, color: DARK.text, flex: '1 1 160px' }}>
          {t('name')} *
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder={t('identities.namePlaceholder')}
            style={inputStyle} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, color: DARK.text, flex: '2 1 200px' }}>
          {t('description')}
          <input value={form.description} onChange={e => set('description', e.target.value)}
            placeholder={t('identities.descriptionPlaceholder')}
            style={inputStyle} />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: DARK.text }}>{t('identities.color')}</span>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => set('color', c)} style={{
              width: 24, height: 24, borderRadius: 6, background: c,
              border: form.color === c ? '2px solid #fff' : '2px solid transparent',
              cursor: 'pointer', transition: 'border 0.1s',
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => onSave(form)} disabled={!form.name}
          style={{ background: BRAND, color: '#000', border: 'none', borderRadius: 9999, padding: '8px 22px', cursor: 'pointer', fontWeight: 700, opacity: form.name ? 1 : 0.5, textTransform: 'uppercase', letterSpacing: '1.4px' }}>
          {t('save')}
        </button>
        <button onClick={onCancel}
          style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 9999, padding: '8px 20px', cursor: 'pointer', color: DARK.text, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}

function ShareSettings({ identity, onUpdate }) {
  const { t } = useTranslation()
  const [pinInput, setPinInput] = useState('')
  const [expiryInput, setExpiryInput] = useState(
    identity.share_expires_at ? new Date(identity.share_expires_at).toISOString().slice(0, 16) : ''
  )
  const [viewCount, setViewCount] = useState(null)
  const [pinMsg, setPinMsg] = useState('')

  const loadViews = async () => {
    try {
      const data = await getShareViewCount(identity.id)
      setViewCount(data.view_count)
    } catch { setViewCount(0) }
  }

  const handleSetPin = async () => {
    if (!pinInput || pinInput.length < 4) return
    try {
      await setSharePin(identity.id, pinInput)
      setPinInput('')
      setPinMsg(t('identities.pinSet'))
      onUpdate()
      setTimeout(() => setPinMsg(''), 2000)
    } catch (e) { setPinMsg(e.response?.data?.detail || t('error')) }
  }

  const handleClearPin = async () => {
    try {
      await clearSharePin(identity.id)
      setPinMsg(t('identities.pinRemoved'))
      onUpdate()
      setTimeout(() => setPinMsg(''), 2000)
    } catch { setPinMsg(t('error')) }
  }

  const handleSetExpiry = async () => {
    const val = expiryInput ? new Date(expiryInput).toISOString() : null
    try {
      await setShareExpiry(identity.id, val)
      onUpdate()
    } catch { /* ignore */ }
  }

  return (
    <div style={{
      marginTop: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.03)',
      borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: DARK.text, display: 'flex', alignItems: 'center', gap: 6 }}>
        <Shield size={13} /> {t('identities.shareSettings')}
      </div>

      {/* PIN */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Shield size={11} />
          {t('identities.pinProtection')}
          {identity.share_pin_set && <span style={{ color: DARK.success, fontWeight: 600, fontSize: 11 }}>{t('identities.active')}</span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*"
            maxLength={6} value={pinInput}
            onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
            placeholder={t('identities.pinPlaceholder')}
            style={{ ...inputStyle, width: 120, marginTop: 0 }}
          />
          <button onClick={handleSetPin} disabled={pinInput.length < 4}
            style={{
              background: pinInput.length >= 4 ? BRAND : 'rgba(255,255,255,0.06)',
              color: pinInput.length >= 4 ? '#000' : 'rgba(255,255,255,0.3)',
              border: 'none', borderRadius: 6, padding: '6px 14px',
              cursor: pinInput.length >= 4 ? 'pointer' : 'default',
              fontSize: 12, fontWeight: 700,
            }}>
            {t('identities.setPIN')}
          </button>
          {identity.share_pin_set && (
            <button onClick={handleClearPin}
              style={{
                background: 'none', border: '1px solid rgba(248,113,113,0.4)',
                color: '#f87171', borderRadius: 6, padding: '5px 12px',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
              }}>
              {t('remove')}
            </button>
          )}
          {pinMsg && <span style={{ fontSize: 11, color: pinMsg.includes('Error') ? '#f87171' : DARK.success, fontWeight: 600 }}>{pinMsg}</span>}
        </div>
      </div>

      {/* Expiry */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
          <Clock size={11} />
          {t('identities.linkExpiry')}
          {identity.share_expires_at && <span style={{ color: DARK.warning, fontWeight: 600, fontSize: 11 }}>
            {t('identities.expires', { date: new Date(identity.share_expires_at).toLocaleDateString() })}
          </span>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="datetime-local" value={expiryInput}
            onChange={e => setExpiryInput(e.target.value)}
            style={{ ...inputStyle, width: 220, marginTop: 0, colorScheme: 'dark' }}
          />
          <button onClick={handleSetExpiry}
            style={{
              background: 'rgba(255,255,255,0.06)',
              color: DARK.text, border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, padding: '5px 14px', cursor: 'pointer',
              fontSize: 12, fontWeight: 600,
            }}>
            {expiryInput ? t('set') : t('clear')}
          </button>
        </div>
      </div>

      {/* View count */}
      <div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Eye size={11} />
          {t('identities.views')}
          {viewCount !== null && <span style={{ fontWeight: 600, color: DARK.text }}>{viewCount}</span>}
          <button onClick={loadViews}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'rgba(255,255,255,0.3)', fontSize: 11, textDecoration: 'underline',
              padding: 0, marginLeft: 4,
            }}>
            {viewCount === null ? t('identities.load') : t('refresh')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Identities() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { data: identities = [], isLoading } = useQuery({ queryKey: ['identities'], queryFn: getIdentities })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: getProjects })
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [linkingId, setLinkingId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)
  const [settingsId, setSettingsId] = useState(null)

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['identities'] })
    qc.invalidateQueries({ queryKey: ['projects'] })
  }

  const createMut = useMutation({
    mutationFn: createIdentity,
    onSuccess: () => { invalidate(); setShowCreate(false) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, data }) => updateIdentity(id, data),
    onSuccess: () => { invalidate(); setEditingId(null) },
  })
  const deleteMut = useMutation({ mutationFn: deleteIdentity, onSuccess: invalidate })
  const linkMut = useMutation({
    mutationFn: ({ identityId, projectId }) => linkProjectIdentity(identityId, projectId),
    onSuccess: invalidate,
  })
  const unlinkMut = useMutation({
    mutationFn: ({ identityId, projectId }) => unlinkProjectIdentity(identityId, projectId),
    onSuccess: invalidate,
  })
  const rotateMut = useMutation({
    mutationFn: (identityId) => rotateShareToken(identityId),
    onSuccess: invalidate,
  })

  const copyShareLink = (identity) => {
    const url = `${window.location.origin}/share/${identity.share_token}`
    navigator.clipboard.writeText(url)
    setCopiedId(identity.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const linkedProjectIds = (identityId) => {
    const linked = new Set()
    for (const p of projects) {
      if (p.identities?.some(i => i.id === identityId)) linked.add(p.id)
    }
    return linked
  }

  if (isLoading) return <p style={{ color: 'rgba(255,255,255,0.35)', padding: 24 }}>{t('loading')}</p>

  return (
    <div className="page-content" style={{ padding: '32px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: DARK.text }}>{t('identities.title')}</h1>
          <p style={{ color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>{t('identities.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ background: BRAND, color: '#000', border: 'none', borderRadius: 9999, padding: '10px 24px', cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.4px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Plus size={14} />{t('identities.new')}
        </button>
      </div>

      {showCreate && (
        <IdentityForm
          onSave={data => createMut.mutate(data)}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {identities.length === 0 && !showCreate ? (
        <EmptyState message={t('identities.empty')} hint={t('identities.emptyHint')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {identities.map(identity => {
            const linked = linkedProjectIds(identity.id)
            const isEditing = editingId === identity.id
            const isLinking = linkingId === identity.id

            if (isEditing) {
              return (
                <IdentityForm
                  key={identity.id}
                  initial={{ name: identity.name, color: identity.color, description: identity.description || '', avatar: identity.avatar || '' }}
                  onSave={data => updateMut.mutate({ id: identity.id, data })}
                  onCancel={() => setEditingId(null)}
                />
              )
            }

            return (
              <div key={identity.id} style={{ background: DARK.surface, borderRadius: 8, padding: '16px 20px', boxShadow: SHADOW_SM }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, background: identity.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: identity.avatar?.length > 1 ? 16 : 18,
                    flexShrink: 0,
                  }}>
                    {identity.avatar || identity.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 16, color: DARK.text }}>{identity.name}</div>
                    {identity.description && (
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>{identity.description}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>
                    {identity.project_count} project{identity.project_count !== 1 ? 's' : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <a href={`/?identity=${identity.id}`} target="_blank" rel="noreferrer"
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: DARK.text }}>
                      <ExternalLink size={13} /> {t('identities.overview')}
                    </a>
                    {identity.share_token && (
                      <>
                        <button
                          onClick={() => copyShareLink(identity)}
                          title="Copy guest share link"
                          style={{
                            background: copiedId === identity.id ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
                            color: copiedId === identity.id ? DARK.success : DARK.text,
                          }}>
                          {copiedId === identity.id ? <Check size={13} /> : <Share2 size={13} />}
                          {copiedId === identity.id ? t('copied') : t('identities.share')}
                        </button>
                        <button
                          onClick={() => { if (confirm('Revoke current share link and generate a new one?')) rotateMut.mutate(identity.id) }}
                          title="Revoke share link"
                          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: 'rgba(255,255,255,0.4)' }}>
                          <RefreshCw size={13} />
                        </button>
                      </>
                    )}
                    <button onClick={() => setSettingsId(settingsId === identity.id ? null : identity.id)}
                      style={{
                        background: settingsId === identity.id ? 'rgba(30,215,96,0.12)' : 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
                        color: settingsId === identity.id ? BRAND : DARK.text,
                      }}>
                      <Shield size={13} /> {t('identities.settings')}
                    </button>
                    <button onClick={() => setLinkingId(isLinking ? null : identity.id)}
                      style={{
                        background: isLinking ? 'rgba(30,215,96,0.12)' : 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4,
                        color: isLinking ? BRAND : DARK.text,
                      }}>
                      <Link2 size={13} /> {t('identities.projects')}
                    </button>
                    <button onClick={() => setEditingId(identity.id)}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', color: DARK.text }}>
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => { if (confirm(`Delete identity "${identity.name}"?`)) deleteMut.mutate(identity.id) }}
                      style={{ background: 'none', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Linked projects */}
                {linked.size > 0 && !isLinking && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    {projects.filter(p => linked.has(p.id)).map(p => (
                      <span key={p.id} style={{
                        fontSize: 12, padding: '3px 10px', borderRadius: 6,
                        background: identity.color + '18', color: identity.color,
                        border: `1px solid ${identity.color}33`, fontWeight: 500,
                      }}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Share settings panel */}
                {settingsId === identity.id && (
                  <ShareSettings identity={identity} onUpdate={invalidate} />
                )}

                {/* Project linking panel */}
                {isLinking && (
                  <div style={{ marginTop: 12, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: DARK.text }}>{t('identities.linkUnlinkProjects')}</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {projects.map(p => {
                        const isLinked = linked.has(p.id)
                        return (
                          <button key={p.id}
                            onClick={() => isLinked
                              ? unlinkMut.mutate({ identityId: identity.id, projectId: p.id })
                              : linkMut.mutate({ identityId: identity.id, projectId: p.id })
                            }
                            style={{
                              display: 'flex', alignItems: 'center', gap: 4,
                              fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                              background: isLinked ? identity.color + '18' : 'rgba(255,255,255,0.05)',
                              color: isLinked ? identity.color : 'rgba(255,255,255,0.4)',
                              border: isLinked ? `1px solid ${identity.color}55` : '1px solid rgba(255,255,255,0.1)',
                              fontWeight: isLinked ? 600 : 400,
                            }}
                          >
                            {isLinked ? <Unlink size={11} /> : <Link2 size={11} />}
                            {p.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
