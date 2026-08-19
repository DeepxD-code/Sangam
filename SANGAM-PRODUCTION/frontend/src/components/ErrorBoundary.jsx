import React from 'react';

/**
 * ErrorBoundary  (Day 52)
 *
 * Catches render-time errors anywhere in its subtree and shows a calm,
 * on-brand recovery screen instead of a blank white page — important for
 * a live stakeholder demo, where a single unexpected null/undefined in
 * one widget should never take down the whole session.
 *
 * Error boundaries in React can only be class components (no Hooks
 * equivalent exists as of React 18) — this is the one intentional
 * exception to the rest of the codebase's function-component convention.
 *
 * Usage: wrap the whole app shell once at the top level, and optionally
 * wrap any individually risky subtree (e.g. a single dashboard widget)
 * with its own instance + a `resetKey` prop so one bad widget can't take
 * the rest of the page down with it.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Developer-facing detail stays in the console; the on-screen fallback
    // stays generic so a live audience never sees a raw stack trace.
    console.error('SANGAM UI error boundary caught:', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) this.props.onReset();
    else window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ onReload: this.handleReload })
        : this.props.fallback;
    }

    return (
      <div className="error-boundary-screen">
        <div className="error-boundary-icon">⚠</div>
        <h2 className="error-boundary-title">Something went wrong</h2>
        <p className="error-boundary-body">
          {this.props.label || 'This section hit an unexpected error.'} The rest of SANGAM is unaffected —
          you can try again, or return to the dashboard.
        </p>
        <div className="error-boundary-actions">
          <button className="btn btn-ghost" onClick={() => (window.location.href = '/')}>← Dashboard</button>
          <button className="btn btn-primary" onClick={this.handleReload}>Try Again</button>
        </div>
      </div>
    );
  }
}
