import { useState } from 'react'
import { qk } from '../api/queryKeys'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shapes, Spline, Plus, Trash2, Lock, Pencil, Check, X } from 'lucide-react'
import {
  getNodeTypes, createNodeType, updateNodeType, deleteNodeType,
  getEdgeTypes, createEdgeType, deleteEdgeType,
} from '../api/client'
import { DARK } from '../constants/theme'
import { NODE_ROLE_DEFS, hasNodeRole, toggleNodeRole } from '../constants/nodeRoles'

function SectionTitle({ icon, title, hint }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {icon}
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: DARK.text }}>{title}</h3>
      </div>
      {hint && <p style={{ margin: '6px 0 0', fontSize: 12, color: DARK.textDim }}>{hint}</p>}
    </div>
  )
}

function RoleBadge({ label }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '1px 6px', textTransform: 'uppercase', letterSpacing: 0.5,
      background: 'rgba(129,140,248,0.14)', color: '#818cf8', border: '1px solid rgba(129,140,248,0.25)',
    }}>
      {label}
    </span>
  )
}

function TypeRow({ item, onDelete, deleting, onEdit, children }) {
  const { t } = useTranslation()
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '9px 0', borderBottom: `1px solid ${DARK.border}`,
    }}>
      {item.color && (
        <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, flexShrink: 0 }} />
      )}
      <span style={{ fontSize: 13, fontWeight: 600, color: DARK.text }}>{item.label}</span>
      <code style={{ fontSize: 11, color: DARK.textDim }}>{item.key}</code>
      {item.usage_count > 0 && (
        <span style={{ fontSize: 10, color: DARK.textDim }} title={t('graphTypes.usageHint')}>
          {t('graphTypes.usage', { n: item.usage_count })}
        </span>
      )}
      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto', alignItems: 'center' }}>
        {children}
        {item.is_builtin ? (
          <Lock size={13} color={DARK.textDim} aria-label="built-in" />
        ) : (
          <>
            {onEdit && (
              <button
                onClick={() => onEdit(item)}
                aria-label={`edit ${item.key}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 4 }}
              >
                <Pencil size={13} />
              </button>
            )}
            <button
              onClick={() => onDelete(item.key)}
              disabled={deleting}
              aria-label="delete"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: DARK.textMid, padding: 4 }}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// Checkbox toggles for a node type's capability roles set (ADR-0040).
function RoleToggles({ roles, onChange }) {
  const { t } = useTranslation()
  return NODE_ROLE_DEFS.map(({ role, labelKey }) => (
    <label key={role} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: DARK.textMid, cursor: 'pointer' }}>
      <input
        type="checkbox"
        aria-label={t(labelKey)}
        checked={(roles || []).includes(role)}
        onChange={e => onChange(toggleNodeRole(roles, role, e.target.checked))}
      />
      {t(labelKey)}
    </label>
  ))
}

// Inline editor for a custom node type: label, color, capability roles (ADR-0040).
function NodeTypeEditRow({ item, onSave, onCancel, saving }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState({
    label: item.label,
    color: item.color || '#818cf8',
    roles: [...(item.roles || [])],
  })
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '9px 0', borderBottom: `1px solid ${DARK.border}` }}>
      <code style={{ fontSize: 11, color: DARK.textDim }}>{item.key}</code>
      <input
        className="kt-input" style={{ width: 150 }}
        aria-label={t('graphTypes.labelPlaceholder')}
        value={draft.label}
        onChange={e => setDraft({ ...draft, label: e.target.value })}
      />
      <input
        type="color" aria-label={t('graphTypes.color')}
        value={draft.color}
        onChange={e => setDraft({ ...draft, color: e.target.value })}
        style={{ width: 34, height: 30, padding: 0, border: `1px solid ${DARK.border}`, background: 'none', cursor: 'pointer' }}
      />
      <RoleToggles roles={draft.roles} onChange={roles => setDraft({ ...draft, roles })} />
      <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
        <button
          className="kt-btn kt-btn-primary" aria-label="save"
          disabled={!draft.label || saving}
          onClick={() => onSave(item.key, draft)}
        >
          <Check size={12} />
        </button>
        <button className="kt-btn" aria-label="cancel" onClick={onCancel}>
          <X size={12} />
        </button>
      </div>
    </div>
  )
}

export default function GraphTypes() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: nodeTypes = [], isLoading: nodeLoading } = useQuery({ queryKey: qk.nodeTypes(), queryFn: getNodeTypes })
  const { data: edgeTypes = [], isLoading: edgeLoading } = useQuery({ queryKey: qk.edgeTypes(), queryFn: getEdgeTypes })

  const emptyNodeForm = { key: '', label: '', color: '#818cf8', roles: [] }
  const [nodeForm, setNodeForm] = useState(emptyNodeForm)
  const [edgeForm, setEdgeForm] = useState({ key: '', label: '', is_containment: false })
  const [editingKey, setEditingKey] = useState(null)

  const nodeCreate = useMutation({
    mutationFn: createNodeType,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.nodeTypes() }); setNodeForm(emptyNodeForm) },
  })
  const nodeDelete = useMutation({
    mutationFn: deleteNodeType,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.nodeTypes() }),
  })
  const nodeUpdate = useMutation({
    mutationFn: ({ key, data }) => updateNodeType(key, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.nodeTypes() }); setEditingKey(null) },
  })
  const edgeCreate = useMutation({
    mutationFn: createEdgeType,
    onSuccess: () => { qc.invalidateQueries({ queryKey: qk.edgeTypes() }); setEdgeForm({ key: '', label: '', is_containment: false }) },
  })
  const edgeDelete = useMutation({
    mutationFn: deleteEdgeType,
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.edgeTypes() }),
  })

  const confirmDelete = (mut, key) => { if (window.confirm(t('graphTypes.deleteConfirm', { key }))) mut.mutate(key) }

  return (
    <div className="kt-page">
      <div className="kt-page-header">
        <div className="kt-page-heading">
          <h1 className="kt-page-title">{t('graphTypes.title')}</h1>
          <p className="kt-page-subtitle">{t('graphTypes.subtitle')}</p>
        </div>
        <Shapes size={22} color="#818cf8" />
      </div>

      <div className="kt-settings-grid">
        {/* Node types */}
        <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
          <SectionTitle
            icon={<Shapes size={16} color="#818cf8" />}
            title={t('graphTypes.nodeTypes')}
            hint={t('graphTypes.nodeTypesHint')}
          />
          {nodeLoading ? (
            <div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div>
          ) : (
            nodeTypes.map(item => (
              item.key === editingKey ? (
                <NodeTypeEditRow
                  key={item.key}
                  item={item}
                  saving={nodeUpdate.isPending}
                  onSave={(key, data) => nodeUpdate.mutate({ key, data })}
                  onCancel={() => setEditingKey(null)}
                />
              ) : (
                <TypeRow
                  key={item.key} item={item}
                  onDelete={(k) => confirmDelete(nodeDelete, k)} deleting={nodeDelete.isPending}
                  onEdit={(it) => setEditingKey(it.key)}
                >
                  {NODE_ROLE_DEFS.map(({ role, labelKey }) => (
                    hasNodeRole(item, role) && <RoleBadge key={role} label={t(labelKey)} />
                  ))}
                </TypeRow>
              )
            ))
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="kt-input" style={{ width: 120 }}
              placeholder={t('graphTypes.keyPlaceholder')}
              value={nodeForm.key}
              onChange={e => setNodeForm({ ...nodeForm, key: e.target.value })}
            />
            <input
              className="kt-input" style={{ width: 160 }}
              placeholder={t('graphTypes.labelPlaceholder')}
              value={nodeForm.label}
              onChange={e => setNodeForm({ ...nodeForm, label: e.target.value })}
            />
            <input
              type="color" aria-label={t('graphTypes.color')}
              value={nodeForm.color}
              onChange={e => setNodeForm({ ...nodeForm, color: e.target.value })}
              style={{ width: 34, height: 30, padding: 0, border: `1px solid ${DARK.border}`, background: 'none', cursor: 'pointer' }}
            />
            <RoleToggles roles={nodeForm.roles} onChange={roles => setNodeForm({ ...nodeForm, roles })} />
            <button
              className="kt-btn kt-btn-primary"
              disabled={!nodeForm.key || !nodeForm.label || nodeCreate.isPending}
              onClick={() => nodeCreate.mutate(nodeForm)}
            >
              <Plus size={12} /> {t('graphTypes.add')}
            </button>
          </div>
        </div>

        {/* Edge types */}
        <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
          <SectionTitle
            icon={<Spline size={16} color="#818cf8" />}
            title={t('graphTypes.edgeTypes')}
            hint={t('graphTypes.edgeTypesHint')}
          />
          {edgeLoading ? (
            <div style={{ fontSize: 12, color: DARK.textDim }}>{t('loading')}</div>
          ) : (
            edgeTypes.map(item => (
              <TypeRow key={item.key} item={item} onDelete={(k) => confirmDelete(edgeDelete, k)} deleting={edgeDelete.isPending}>
                {item.is_containment && <RoleBadge label={t('graphTypes.roleContainment')} />}
                {item.is_symmetric && <RoleBadge label={t('graphTypes.roleSymmetric')} />}
              </TypeRow>
            ))
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="kt-input" style={{ width: 120 }}
              placeholder={t('graphTypes.keyPlaceholder')}
              value={edgeForm.key}
              onChange={e => setEdgeForm({ ...edgeForm, key: e.target.value })}
            />
            <input
              className="kt-input" style={{ width: 160 }}
              placeholder={t('graphTypes.labelPlaceholder')}
              value={edgeForm.label}
              onChange={e => setEdgeForm({ ...edgeForm, label: e.target.value })}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: DARK.textMid, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={edgeForm.is_containment}
                onChange={e => setEdgeForm({ ...edgeForm, is_containment: e.target.checked })}
              />
              {t('graphTypes.roleContainment')}
            </label>
            <button
              className="kt-btn kt-btn-primary"
              disabled={!edgeForm.key || !edgeForm.label || edgeCreate.isPending}
              onClick={() => edgeCreate.mutate(edgeForm)}
            >
              <Plus size={12} /> {t('graphTypes.add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
