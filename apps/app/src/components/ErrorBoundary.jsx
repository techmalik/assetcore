import { Component } from 'react'

export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--n100)', padding: 24 }}>
        <div style={{ background: 'var(--n0)', border: 'var(--bdr)', borderRadius: 8, padding: '32px 40px', maxWidth: 480, textAlign: 'center', boxShadow: 'var(--sh-md)' }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 16px' }}>
            <circle cx="12" cy="12" r="10" stroke="var(--sr)" strokeWidth="1.4" />
            <path d="M12 7v5M12 16v.5" stroke="var(--sr)" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <h2 style={{ fontFamily: 'var(--ff-d)', fontSize: 18, fontWeight: 700, color: 'var(--n950)', marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ fontSize: 13, color: 'var(--n500)', marginBottom: 20, lineHeight: 1.6 }}>
            An unexpected error occurred. Try reloading the page — if this keeps happening, contact support.
          </p>
          <div style={{ fontFamily: 'var(--ff-m)', fontSize: 11, color: 'var(--srt)', background: 'var(--srb)', border: '1px solid var(--srbr)', borderRadius: 4, padding: '8px 12px', textAlign: 'left', marginBottom: 20, wordBreak: 'break-word' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload() }}
            className="btn btn-primary"
            style={{ height: 38, padding: '0 20px', fontSize: 13 }}
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
