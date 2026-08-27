import { Component } from 'react'
import i18n from '../i18n'
import { DARK } from '../constants/theme'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: DARK.bg,
          color: DARK.text,
          gap: 16,
          padding: 24,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 32 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{i18n.t('errorBoundary.title')}</div>
          <div style={{ fontSize: 13, color: DARK.textMid, maxWidth: 480 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '8px 20px',
              background: DARK.info,
              color: 'var(--kt-on-fill)',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {i18n.t('errorBoundary.reload')}
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
