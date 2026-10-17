/**
 * JrxErrorBoundary — Production-grade React error boundary for all 5 products
 * Features: Governance-themed fallback, retry logic, error reporting to gateway
 * Version: 5.1.0
 */

import React, { Component, ErrorInfo } from 'react';

import { nv } from '../lib/jrx-api-paths';
import { JRX_PLATFORM_LABEL, JRX_REGISTRY_RUNTIME } from '../lib/jrx-registry-stats';
interface Props {
  children: React.ReactNode;
  productName?: string;
  fallbackMessage?: string;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
}

export class JrxErrorBoundary extends Component<Props, State> {
  private readonly MAX_RETRIES = 3;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);

    // Non-blocking error report to gateway
    fetch(nv('health/client-error'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product: this.props.productName || 'unknown',
        error: error.message,
        stack: error.stack?.slice(0, 500),
        componentStack: errorInfo.componentStack?.slice(0, 500),
        timestamp: new Date().toISOString(),
        version: JRX_REGISTRY_RUNTIME.registryVersion,
      }),
    }).catch(() => { /* non-fatal */ });
  }

  handleRetry = (): void => {
    if (this.state.retryCount < this.MAX_RETRIES) {
      this.setState(s => ({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: s.retryCount + 1,
      }));
    } else {
      window.location.reload();
    }
  };

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    const { productName = 'Platform', fallbackMessage } = this.props;
    const { retryCount } = this.state;
    const canRetry = retryCount < this.MAX_RETRIES;

    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
        padding: '2rem',
        fontFamily: 'Inter, system-ui, sans-serif',
      }}>
        <div style={{
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(139,92,246,0.3)',
          borderRadius: '1rem',
          padding: '2.5rem',
          maxWidth: '480px',
          width: '100%',
          textAlign: 'center',
          backdropFilter: 'blur(12px)',
        }}>
          {/* Governance badge indicator */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(239,68,68,0.15)',
            border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: '9999px',
            padding: '0.4rem 1rem',
            marginBottom: '1.5rem',
            color: '#f87171',
            fontSize: '0.75rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <span>⚠</span>
            <span>CRITICAL RISK — UI Error</span>
          </div>

          <h2 style={{ color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.75rem' }}>
            {productName} encountered an error
          </h2>

          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            {fallbackMessage || 'An unexpected error occurred. Your session data is safe. Please retry or contact support.'}
          </p>

          {/* Error details (collapsed) */}
          {this.state.error && (
            <details style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <summary style={{ color: '#64748b', cursor: 'pointer', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                Technical details
              </summary>
              <code style={{
                display: 'block',
                background: 'rgba(0,0,0,0.3)',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.75rem',
                color: '#fca5a5',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {this.state.error.message}
              </code>
            </details>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={this.handleRetry}
              style={{
                background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                color: '#fff',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '0.625rem 1.5rem',
                fontSize: '0.9rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {canRetry ? `Retry (${this.MAX_RETRIES - retryCount} left)` : 'Reload Page'}
            </button>
            <button
              onClick={() => { window.location.href = '/'; }}
              style={{
                background: 'transparent',
                color: '#94a3b8',
                border: '1px solid rgba(148,163,184,0.3)',
                borderRadius: '0.5rem',
                padding: '0.625rem 1.5rem',
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              Go Home
            </button>
          </div>

          <p style={{ marginTop: '1.5rem', color: '#475569', fontSize: '0.75rem' }}>
            {JRX_PLATFORM_LABEL} · Error reference: {Date.now().toString(36).toUpperCase()}
          </p>
        </div>
      </div>
    );
  }
}

export default JrxErrorBoundary;
