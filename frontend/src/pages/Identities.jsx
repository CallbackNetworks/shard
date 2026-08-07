import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit3, Trash2, Link2, Unlink, Shield } from 'lucide-react'
import {
  getIdentities, createIdentity, updateIdentity, deleteIdentity,
  getProjects, linkProjectIdentity, unlinkProjectIdentity,
} from '../api/client'
import { BRAND, DARK } from '../constants/theme'
import NodeShareFacet from '../components/NodeShareFacet'
import EmptyState from '../components/shared/EmptyState'

const COLORS = [
  '#5e6ad2', '#facc15', '#facc15', '#f59e0b', '#3b82f6',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#f97316',
  '#14b8a6', '#a855f7', '#e11d48', '#0ea5e9',
]

function IdentityForm({ initial, onSave, onCancel }) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial || { name: '', color: '#5e6ad2', description: '', avatar: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="kt-panel" style={{ padding: 20, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: DARK.text, flex: '0 0 auto' }}>
          {t('identities.avatar')}
          <input value={form.avatar} onChange={e => set('avatar', e.target.value)}
            placeholder={t('identities.avatarPlaceholder')}
            maxLength={2}
            className="kt-input"
            style={{ width: 48, textAlign: 'center', fontSize: 16, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 700, color: DARK.text, flex: '1 1 160px' }}>
          {t('name')} *
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder={t('identities.namePlaceholder')}
            className="kt-input" style={{ marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13, fontWeight: 600, color: DARK.text, flex: '2 1 200px' }}>
          {t('description')}
          <input value={form.description} onChange={e => set('description', e.target.value)}
            placeholder={t('identities.descriptionPlaceholder')}
            className="kt-input" style={{ marginTop: 4 }} />
        </label>
      </div>
      <div style={{ marginTop: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: DARK.text }}>{t('identities.color')}</span>
        <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => set('color', c)} style={{
              width: 24, height: 24, borderRadius: 0, background: c,
              border: form.color === c ? '2px solid #fff' : '2px solid transparent',
              cursor: 'pointer', transition: 'border 0.1s',
            }} />
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button onClick={() => onSave(form)} disabled={!form.name}
          className="kt-btn kt-btn-primary" style={{ opacity: form.name ? 1 : 0.5 }}>
          {t('save')}
        </button>
        <button onClick={onCancel} className="kt-btn">
          {t('cancel')}
        </button>
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
  const linkedProjectIds = (identityId) => {
    const linked = new Set()
    for (const p of projects) {
      if (p.identities?.some(i => i.id === identityId)) linked.add(p.id)
    }
    return linked
  }

  if (isLoading) return <p className="kt-muted" style={{ padding: 24 }}>{t('loading')}</p>

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('identities.title')}</h1>
          <p className="kt-page-subtitle">{t('identities.subtitle')}</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="kt-btn kt-btn-primary">
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
        <div className="kt-stack" style={{ gap: 12 }}>
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
              <div key={identity.id} className="kt-card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 0, background: identity.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontWeight: 700, fontSize: identity.avatar?.length > 1 ? 16 : 18,
                    flexShrink: 0,
                  }}>
                    {identity.avatar || identity.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 16, color: DARK.text }}>{identity.name}</div>
                    {identity.description && (
                      <div style={{ fontSize: 13, color: 'rgba(var(--kt-ink-rgb), 0.35)', marginTop: 2 }}>{identity.description}</div>
                    )}
                  </div>
                  <span className="kt-badge" style={{ color: 'rgba(var(--kt-ink-rgb), 0.35)', background: 'rgba(var(--kt-ink-rgb), 0.06)' }}>
                    {identity.project_count} project{identity.project_count !== 1 ? 's' : ''}
                  </span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {/* Share link, calendar link, rotate, PIN, expiry, guest notes and
                        view count all live in the one share panel behind this button. */}
                    <button onClick={() => setSettingsId(settingsId === identity.id ? null : identity.id)}
                      title={t('identities.settings')} aria-label={t('identities.settings')}
                      style={{
                        background: settingsId === identity.id ? 'rgba(250,204,21,0.12)' : 'rgba(var(--kt-ink-rgb), 0.06)',
                        border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 0, padding: '6px 8px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center',
                        color: settingsId === identity.id ? BRAND : DARK.text,
                      }}>
                      <Shield size={13} />
                    </button>
                    <button onClick={() => setLinkingId(isLinking ? null : identity.id)}
                      title={t('identities.projects')} aria-label={t('identities.projects')}
                      style={{
                        background: isLinking ? 'rgba(250,204,21,0.12)' : 'rgba(var(--kt-ink-rgb), 0.06)',
                        border: '1px solid rgba(var(--kt-ink-rgb), 0.1)', borderRadius: 0, padding: '6px 8px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center',
                        color: isLinking ? BRAND : DARK.text,
                      }}>
                      <Link2 size={13} />
                    </button>
                    <button onClick={() => setEditingId(identity.id)}
                      title={t('edit')} aria-label={t('edit')}
                      className="kt-btn" style={{ padding: '6px 8px', color: DARK.text }}>
                      <Edit3 size={13} />
                    </button>
                    <button onClick={() => { if (confirm(`Delete persona "${identity.name}"?`)) deleteMut.mutate(identity.id) }}
                      title={t('delete')} aria-label={t('delete')}
                      className="kt-btn" style={{ background: 'none', border: '1px solid rgba(250,204,21,0.4)', color: '#facc15', padding: '6px 8px' }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Linked projects */}
                {linked.size > 0 && !isLinking && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    {projects.filter(p => linked.has(p.id)).map(p => (
                      <span key={p.id} style={{
                        fontSize: 12, padding: '3px 10px', borderRadius: 0,
                        background: identity.color + '18', color: identity.color,
                        border: `1px solid ${identity.color}33`, fontWeight: 500,
                      }}>
                        {p.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Share settings panel — the same component every other shareable
                    node uses (ADR-0070); an identity's list read holds the share
                    state flattened, which the facet reads directly. */}
                {settingsId === identity.id && (
                  <div style={{ marginTop: 12 }}>
                    <NodeShareFacet node={identity} subscribable invalidateKeys={[['identities']]} />
                  </div>
                )}

                {/* Project linking panel */}
                {isLinking && (
                  <div className="kt-panel" style={{ marginTop: 12, padding: '12px 16px' }}>
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
                              fontSize: 12, padding: '4px 10px', borderRadius: 0, cursor: 'pointer',
                              background: isLinked ? identity.color + '18' : 'rgba(var(--kt-ink-rgb), 0.05)',
                              color: isLinked ? identity.color : 'rgba(var(--kt-ink-rgb), 0.4)',
                              border: isLinked ? `1px solid ${identity.color}55` : '1px solid rgba(var(--kt-ink-rgb), 0.1)',
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
