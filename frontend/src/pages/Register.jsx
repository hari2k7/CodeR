import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authAPI } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Register() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1: Registration Form, 2: OTP Verification
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    college: 'MIT'
  });
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setInterval(() => {
        setResendCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const handleStep1Submit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await authAPI.register(formData);
      setStep(2);
      setResendCooldown(60);
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await authAPI.verifyOtp({
        email: formData.email,
        otp: otp.trim()
      });
      login(res.token, res.user);
      navigate('/problems');
    } catch (err) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    setError(null);
    try {
      await authAPI.resendOtp(formData.email);
      setResendCooldown(60);
    } catch (err) {
      setError(err.message || 'Resend failed');
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '3rem auto' }}>
      <div className="card">
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.6rem', fontWeight: '800', marginBottom: '0.4rem' }}>
            {step === 1 ? 'Create an Account' : 'Verify Your Email'}
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            {step === 1
              ? 'Join CodeRank to compete on real-time Redis leaderboards'
              : `Enter the 6-digit code sent to ${formData.email}`}
          </p>
        </div>

        {error && (
          <div className="banner-lockout" style={{ marginBottom: '1rem' }}>
            <span>⚠️</span>
            <span style={{ fontSize: '0.85rem' }}>{error}</span>
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleStep1Submit}>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. dev_coder"
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">University / College</label>
              <select
                className="form-select"
                value={formData.college}
                onChange={(e) => setFormData({ ...formData, college: e.target.value })}
              >
                <option value="MIT">MIT</option>
                <option value="Stanford">Stanford</option>
                <option value="UC Berkeley">UC Berkeley</option>
                <option value="Carnegie Mellon">Carnegie Mellon</option>
                <option value="Harvard">Harvard</option>
                <option value="IIT Bombay">IIT Bombay</option>
                <option value="Oxford">Oxford</option>
                <option value="Cambridge">Cambridge</option>
                <option value="ETH Zurich">ETH Zurich</option>
                <option value="Tsinghua">Tsinghua</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                placeholder="name@university.edu"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="••••••••"
                required
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '0.5rem' }} disabled={loading}>
              {loading ? 'Sending Verification...' : 'Continue to Verification'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp}>
            <div style={{
              background: 'rgba(99, 102, 241, 0.1)',
              border: '1px dashed rgba(99, 102, 241, 0.4)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '1.25rem',
              fontSize: '0.8rem',
              color: '#A5B4FC'
            }}>
              💡 <strong>Demo Fallback Notice:</strong> If SMTP is not active, the OTP code is displayed in your server console log.
            </div>

            <div className="form-group">
              <label className="form-label">6-Digit One-Time Password</label>
              <input
                type="text"
                className="form-input font-mono"
                style={{ fontSize: '1.5rem', letterSpacing: '8px', textAlign: 'center' }}
                maxLength={6}
                placeholder="123456"
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
              />
            </div>

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading || otp.length !== 6}>
              {loading ? 'Verifying Code...' : 'Verify OTP & Finish'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem' }}>
              {resendCooldown > 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>
                  Resend code in {resendCooldown}s
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: '600' }}
                >
                  Resend OTP Code
                </button>
              )}
            </div>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent-primary)', fontWeight: '600' }}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
