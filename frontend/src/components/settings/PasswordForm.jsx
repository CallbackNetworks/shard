import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import { changePassword } from '../../api/client'
import { DARK } from '../../constants/theme'
import { SectionTitle } from './primitives'
import s from './PasswordForm.module.css'

/** Change-password card; self-contained (owns its state + mutation). */
export default function PasswordForm() {
  const { t } = useTranslation()
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState(null)

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

  return (
    <div className="kt-card" style={{ padding: 20, marginBottom: 16 }}>
      <SectionTitle
        icon={<Lock size={16} color={DARK.warning} />}
        title={t('settings.changePassword')}
      />
      <div className={s.stack}>
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
          <div className={pwMsg.type === 'success' ? `${s.message} ${s.messageSuccess}` : `${s.message} ${s.messageError}`}>
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
  )
}
