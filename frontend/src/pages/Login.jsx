import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);

  useEffect(() => {
    let timer;
    if (lockoutRemaining > 0) {
      timer = setInterval(() => {
        setLockoutRemaining((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [lockoutRemaining]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await authAPI.login(identifier, password);
      login(res.token, res.user);
      navigate('/problems');
    } catch (err) {
      if (err.code === 'ACCOUNT_LOCKED' && err.retryAfter) {
        setLockoutRemaining(err.retryAfter);
      }
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (user) => {
    setIdentifier(user);
    setPassword('Test@1234');
    setError(null);
  };

  return (
    <div style={{ maxWidth: '440px', margin: '3rem auto' }}>
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.6rem', fontWeight: '800', marginBottom: '0.4rem' }}>
            Welcome Back
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Sign in to view your real-time ranking and solved problems
          </p>
        </div>

        {lockoutRemaining > 0 && (
          <div className="banner-lockout">
            <span style={{ fontSize: '1.25rem' }}>🔒</span>
            <div>
              <div style={{ fontWeight: '700', fontSize: '0.9rem' }}>Account Temporarily Locked</div>
              <div style={{ fontSize: '0.8rem' }}>
                Too many failed attempts. Try again in <strong>{lockoutRemaining}s</strong> (Redis TTL).
              </div>
            </div>
          </div>
        )}

        {error && lockoutRemaining === 0 && (
          <div className="banner-lockout">
            <span>⚠️</span>
            <span style={{ fontSize: '0.85rem' }}>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Username or Email</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. alex_code or alex@code.edu"
              required
              disabled={lockoutRemaining > 0}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              required
              disabled={lockoutRemaining > 0}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '0.5rem' }}
            disabled={loading || lockoutRemaining > 0}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.6rem' }}>
            ⚡ <strong>Demo Quick Fill (Password: Test@1234):</strong>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span className="chip-demo" onClick={() => handleQuickFill('alex_code')}>
              alex_code (MIT)
            </span>
            <span className="chip-demo" onClick={() => handleQuickFill('bob_dev')}>
              bob_dev (Stanford)
            </span>
            <span className="chip-demo" onClick={() => handleQuickFill('carol_algo')}>
              carol_algo (Berkeley)
            </span>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--accent-primary)', fontWeight: '600' }}>
            Create one
          </Link>
        </div>
      </div>
    </div>
  );
}
