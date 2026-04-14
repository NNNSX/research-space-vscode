import './bridge'; // Must be first — initialises acquireVsCodeApi() before anything else
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

// ── Send errors to Extension Host which writes them to disk ──────────────────

function reportError(msg: string) {
  try {
    // Write via vscode api postMessage so Extension Host can save to file
    if (window.__rsVsCodeApi) {
      window.__rsVsCodeApi.postMessage({ type: 'webviewError', message: msg });
    }
  } catch (_) { /* ignore */ }
}

// ── Global error boundary ────────────────────────────────────────────────────

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(err: unknown) {
    const msg = err instanceof Error ? (err.stack ?? err.message) : String(err);
    return { error: msg };
  }
  componentDidCatch(err: unknown, info: React.ErrorInfo) {
    const msg = [
      err instanceof Error ? (err.stack ?? err.message) : String(err),
      info.componentStack ?? '',
    ].join('\n');
    reportError('React ErrorBoundary:\n' + msg);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24, fontFamily: 'monospace', fontSize: 12,
          color: '#f88', background: '#1e1e1e', whiteSpace: 'pre-wrap',
          overflowY: 'auto', height: '100vh',
        }}>
          <b style={{ color: '#ff6b6b', fontSize: 14 }}>❌ Research Space — Render Error</b>
          {'\n\n(Error written to rs-error.log in your workspace)\n\n'}
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Window-level error listeners ─────────────────────────────────────────────

window.addEventListener('error', (e) => {
  // ResizeObserver "loop completed" is a benign browser notification that fires
  // when ReactFlow / MiniMap resize during a frame. It is NOT a crash — ignore it.
  if (e.message && e.message.includes('ResizeObserver loop')) { return; }
  const msg = `Uncaught Error: ${e.message}\nat ${e.filename}:${e.lineno}\n${e.error?.stack ?? ''}`;
  reportError(msg);
  showFatalError(msg);
});

window.addEventListener('unhandledrejection', (e) => {
  const msg = `Unhandled Rejection: ${
    e.reason instanceof Error ? (e.reason.stack ?? e.reason.message) : String(e.reason)
  }`;
  reportError(msg);
  showFatalError(msg);
});

function showFatalError(msg: string) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding:24px;font-family:monospace;font-size:12px;color:#f88;background:#1e1e1e;white-space:pre-wrap;height:100vh;overflow-y:auto">
<b style="color:#ff6b6b;font-size:14px">❌ Research Space — Fatal Error</b>

(Error written to <b>rs-error.log</b> in your workspace root)

${msg}
</div>`;
  }
}

// ── Mount ────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById('root');
if (!rootEl) {
  reportError('Could not find #root element — HTML template broken');
} else {
  const reactRoot = ReactDOM.createRoot(rootEl);
  reactRoot.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
