import React, { useState } from 'react';
import { api, ApiError } from '../api/client.js';

/**
 * Login Page  (Day 33 — ops-console aesthetic)
 *
 * Full-screen dark card matching the SANGAM design system.
 * No sidebar — authentication precedes layout.
 */
export default function LoginPage({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    setError(null);
    if (!username.trim()) { setError('Username is required.'); return; }
    if (!password)        { setError('Password is required.'); return; }
    setLoading(true);
    try {
      const result = await api.login(username.trim(), password);
      if (result?.success && result.user) {
        onLoginSuccess(result.user);
      } else {
        setError('Login did not return a valid session.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if      (err.status === 423) setError('Account locked — contact your unit administrator.');
        else if (err.status === 401) setError('Incorrect username or password.');
        else if (err.status === 503) setError('Database unavailable — check server status.');
        else                          setError(err.message || 'Authentication failed.');
      } else {
        setError('Unexpected error. Try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      {/* Decorative grid background */}
      <div className="login-grid-bg" aria-hidden="true" />

      <div className="login-card">
        {/* Top badge */}
        <div className="login-classification">RESTRICTED ACCESS</div>

        {/* Wordmark */}
        <div className="login-wordmark">
          SANGAM<span className="login-dot">.</span>
        </div>
        <div className="login-subtitle">Supply Chain Command System</div>

        {/* Divider */}
        <div className="login-divider" />

        {/* Form */}
        <div className="login-form">
          <div className="form-group">
            <label className="form-label" htmlFor="login-username">Service Username</label>
            <input
              id="login-username"
              className="form-input"
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit(e)}
              disabled={loading}
              placeholder="e.g. lt.col.verma"
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              className="form-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit(e)}
              disabled={loading}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="login-error" role="alert">
              <span className="login-error-icon">⚠</span> {error}
            </div>
          )}

          <button
            className="btn btn-primary login-submit"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <span className="login-loading">
                <span className="spinner-inline" /> Authenticating…
              </span>
            ) : 'AUTHENTICATE →'}
          </button>
        </div>

        {/* Footer */}
        <div className="login-footer">
          Unauthorised access is a criminal offence under IT Act 2000
        </div>
      </div>
    </div>
  );
}
