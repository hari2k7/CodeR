import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { statsAPI, submissionsAPI, authAPI } from '../api.js';

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();

  const [streakData, setStreakData] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  // Profile Edit State
  const [editUsername, setEditUsername] = useState(user?.username || '');
  const [editCollege, setEditCollege] = useState(user?.college || 'MIT');
  const [updating, setUpdating] = useState(false);
  const [updateMessage, setUpdateMessage] = useState(null);
  const [updateError, setUpdateError] = useState(null);

  // Account Deletion State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user) {
      setEditUsername(user.username || '');
      setEditCollege(user.college || 'MIT');
    }
  }, [user]);

  useEffect(() => {
    async function loadProfileData() {
      if (!user) return;
      setLoading(true);
      try {
        const [streakRes, subRes] = await Promise.all([
          statsAPI.getStreak(user.id),
          submissionsAPI.list({ userId: user.id, limit: 15 })
        ]);
        if (streakRes) setStreakData(streakRes);
        if (subRes?.submissions) setSubmissions(subRes.submissions);
      } catch (err) {
        console.error('Failed to load profile data:', err);
      } finally {
        setLoading(false);
      }
    }
    loadProfileData();
  }, [user]);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setUpdateMessage(null);
    setUpdateError(null);
    setUpdating(true);

    try {
      const res = await authAPI.updateProfile({
        username: editUsername.trim(),
        college: editCollege
      });
      if (res?.user) {
        setUser(res.user);
        setUpdateMessage('Profile updated successfully in Redis!');
      }
    } catch (err) {
      setUpdateError(err.message || 'Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setUpdateError(null);
    try {
      await authAPI.deleteAccount();
      await logout();
      navigate('/register');
    } catch (err) {
      setUpdateError(err.message || 'Failed to delete account');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!user) {
    return <div style={{ textAlign: 'center', padding: '4rem' }}>Please log in to view your profile.</div>;
  }

  return (
    <div>
      {/* User Header Card */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{
          width: '72px',
          height: '72px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366F1 0%, #06B6D4 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2rem',
          fontWeight: '800'
        }}>
          {user.username ? user.username[0].toUpperCase() : 'U'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '800' }}>{user.username}</h1>
            <span className="badge badge-tag">{user.college || 'Competitive Programmer'}</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Email: <span className="font-mono">{user.email}</span> • Rating: <strong style={{ color: '#FCD34D' }}>{user.rating}</strong> • Solved: <strong style={{ color: 'var(--accent-cyan)' }}>{user.solved}</strong>
          </div>
        </div>
      </div>

      {/* Edit Profile & Account Settings Section */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <div>
            <h2 className="card-title">Account Settings</h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Update your username (atomic <code>SETNX</code>) or university affiliation (updates <code>lb:college</code>)
            </div>
          </div>
        </div>

        {updateMessage && (
          <div style={{
            background: 'var(--status-ac-bg)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--status-ac)',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: '600',
            marginBottom: '1rem'
          }}>
            ✓ {updateMessage}
          </div>
        )}

        {updateError && (
          <div className="banner-lockout" style={{ marginBottom: '1rem' }}>
            <span>⚠️</span>
            <span style={{ fontSize: '0.85rem' }}>{updateError}</span>
          </div>
        )}

        <form onSubmit={handleUpdateProfile} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '1rem', alignItems: 'end' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              required
              minLength={3}
              maxLength={20}
            />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">University / College</label>
            <select
              className="form-select"
              value={editCollege}
              onChange={(e) => setEditCollege(e.target.value)}
            >
              <option value="MIT">MIT</option>
              <option value="Amrita University">Amrita University</option>
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

          <button type="submit" className="btn btn-primary" disabled={updating} style={{ height: '42px', minWidth: '130px' }}>
            {updating ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </div>

      {/* Redis Bitmap Activity Streak Card */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="card-header">
          <div>
            <h2 className="card-title">Daily Activity Streak</h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
              Stored memory-efficiently in Redis Bitmap (<code>SETBIT streak:{user.id}:2026 &lt;day&gt; 1</code>)
            </div>
          </div>
          <div style={{ display: 'flex', gap: '1.5rem', textAlign: 'right' }}>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--status-ac)' }}>
                {streakData?.currentStreak || 0} Days
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Current Streak
              </div>
            </div>
            <div>
              <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--accent-cyan)' }}>
                {streakData?.totalActiveDays || 0} Days
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                From BITCOUNT
              </div>
            </div>
          </div>
        </div>

        {/* 30-Day Contribution Heatmap Grid */}
        <div style={{ marginTop: '1rem' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
            Last 30 Days Activity Log:
          </div>
          <div className="heatmap-grid">
            {streakData?.recentActivity?.map((act) => (
              <div
                key={act.day}
                className={`heatmap-box ${act.active ? 'active' : ''}`}
                title={`Day ${act.day}: ${act.active ? 'Active Solve Recorded' : 'No Activity'}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Recent Submissions History Table */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 className="card-title" style={{ marginBottom: '1rem' }}>Recent Submission History</h2>
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '70px' }}>ID</th>
                <th>Problem</th>
                <th style={{ width: '90px' }}>Language</th>
                <th style={{ width: '100px' }}>Verdict</th>
                <th style={{ width: '80px' }}>Time</th>
                <th style={{ width: '80px' }}>Memory</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    Loading submission history...
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    No submissions found for this user yet.
                  </td>
                </tr>
              ) : (
                submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="font-mono" style={{ color: 'var(--text-muted)' }}>
                      #{s.id}
                    </td>
                    <td style={{ fontWeight: '600' }}>{s.problemTitle}</td>
                    <td className="font-mono" style={{ textTransform: 'uppercase', fontSize: '0.8rem' }}>
                      {s.language}
                    </td>
                    <td>
                      <span className={`badge ${
                        s.verdict === 'AC' ? 'badge-ac' : s.verdict === 'WA' ? 'badge-wa' : 'badge-tle'
                      }`}>
                        {s.verdict}
                      </span>
                    </td>
                    <td className="font-mono">{s.executionTime ? `${s.executionTime}ms` : '—'}</td>
                    <td className="font-mono">{s.memory ? `${s.memory}MB` : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {new Date(parseInt(s.submittedAt, 10)).toLocaleTimeString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Danger Zone: Account Deletion */}
      <div className="card" style={{
        borderColor: 'rgba(244, 63, 94, 0.4)',
        background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.6) 0%, rgba(244, 63, 94, 0.05) 100%)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: '800', color: '#FDA4AF', marginBottom: '0.25rem' }}>
              Danger Zone
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Permanently delete your account, session, submission logs, activity streaks, and leaderboard scores from Redis.
            </p>
          </div>

          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="btn"
              style={{
                backgroundColor: '#DC2626',
                color: '#FFF',
                fontWeight: '700',
                padding: '0.6rem 1.25rem',
                border: '1px solid #EF4444',
                boxShadow: '0 4px 14px rgba(220, 38, 38, 0.4)'
              }}
            >
              Delete Account
            </button>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#FDA4AF', fontWeight: '600' }}>
                Are you sure? This cannot be undone.
              </span>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="btn"
                style={{
                  backgroundColor: '#B91C1C',
                  color: '#FFF',
                  fontWeight: '700',
                  padding: '0.5rem 1rem',
                  fontSize: '0.85rem'
                }}
              >
                {deleting ? 'Deleting...' : 'Yes, Delete My Account'}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-outline"
                style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
