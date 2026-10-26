import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { statsAPI, submissionsAPI } from '../api.js';

export default function Profile() {
  const { user } = useAuth();
  const [streakData, setStreakData] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

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

  if (!user) {
    return <div style={{ textAlign: 'center', padding: '4rem' }}>Please log in to view your profile.</div>;
  }

  return (
    <div>
      {/* User Header Card */}
      <div className="card" style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
            <h1 style={{ fontSize: '1.75rem', fontWeight: '800' }}>{user.username}</h1>
            <span className="badge badge-tag">{user.college || 'Competitive Programmer'}</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Email: <span className="font-mono">{user.email}</span> • Rating: <strong style={{ color: '#FCD34D' }}>{user.rating}</strong> • Solved: <strong style={{ color: 'var(--accent-cyan)' }}>{user.solved}</strong>
          </div>
        </div>
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
      <div className="card">
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
    </div>
  );
}
