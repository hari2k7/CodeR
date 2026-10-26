import React, { useState, useEffect } from 'react';
import { leaderboardAPI } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Leaderboard() {
  const { isAuthenticated, user } = useAuth();

  const [activeTab, setActiveTab] = useState('global'); // 'global', 'colleges', 'contest'
  const [leaderboard, setLeaderboard] = useState([]);
  const [colleges, setColleges] = useState([]);
  const [contests, setContests] = useState([]);
  const [myRankInfo, setMyRankInfo] = useState(null);
  const [cacheHeader, setCacheHeader] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sseConnected, setSseConnected] = useState(false);
  const [recentUpdates, setRecentUpdates] = useState(new Set()); // IDs of users to highlight

  // Load Leaderboard data
  const loadLeaderboardData = async () => {
    try {
      if (activeTab === 'global') {
        const res = await leaderboardAPI.get({ limit: 100, offset: 0 });
        if (res?.leaderboard) {
          setLeaderboard(res.leaderboard);
          setCacheHeader(res._cacheHeader || null);
        }
      } else if (activeTab === 'colleges') {
        const res = await leaderboardAPI.colleges();
        if (res?.colleges) setColleges(res.colleges);
      } else if (activeTab === 'contest') {
        const contestList = await leaderboardAPI.contests();
        if (contestList?.contests) setContests(contestList.contests);
        const res = await leaderboardAPI.get({ contestId: 1, limit: 100, offset: 0 });
        if (res?.leaderboard) setLeaderboard(res.leaderboard);
      }
    } catch (err) {
      console.error('Failed to load leaderboard:', err);
    } finally {
      setLoading(false);
    }
  };

  // Load My Rank
  const loadMyRank = async () => {
    if (!isAuthenticated) return;
    try {
      const res = await leaderboardAPI.me();
      setMyRankInfo(res);
    } catch (err) {
      console.error('Failed to load my rank:', err);
    }
  };

  useEffect(() => {
    loadLeaderboardData();
    loadMyRank();
  }, [activeTab, isAuthenticated]);

  // Connect to SSE stream (/leaderboard/stream)
  useEffect(() => {
    const eventSource = new EventSource('/leaderboard/stream');

    eventSource.onopen = () => {
      setSseConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'score_update') {
          // Highlight updated user row
          setRecentUpdates((prev) => new Set([...prev, Number(data.userId)]));
          setTimeout(() => {
            setRecentUpdates((prev) => {
              const next = new Set(prev);
              next.delete(Number(data.userId));
              return next;
            });
          }, 3500);

          // Refresh data immediately
          loadLeaderboardData();
          loadMyRank();
        }
      } catch (err) {}
    };

    eventSource.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
    };
  }, [activeTab]);

  return (
    <div>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: '800', letterSpacing: '-0.5px' }}>
            Live Leaderboard
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Powered by Redis Sorted Sets (<code>lb:global</code>, <code>lb:college</code>, <code>lb:contest:1</code>)
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {cacheHeader && (
            <span style={{
              fontSize: '0.75rem',
              fontWeight: '700',
              padding: '0.25rem 0.6rem',
              borderRadius: '4px',
              background: cacheHeader === 'HIT' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
              color: cacheHeader === 'HIT' ? '#34D399' : '#60A5FA',
              border: `1px solid ${cacheHeader === 'HIT' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
            }}>
              X-Cache: {cacheHeader}
            </span>
          )}

          <div className="live-indicator">
            <span className="live-dot" style={{ backgroundColor: sseConnected ? '#10B981' : '#F59E0B' }} />
            <span>{sseConnected ? 'Pub/Sub Stream Live' : 'Connecting Stream...'}</span>
          </div>
        </div>
      </div>

      {/* "My Rank" Context Card */}
      {isAuthenticated && myRankInfo?.myRank && (
        <div className="card" style={{ marginBottom: '1.75rem', background: 'linear-gradient(135deg, rgba(31, 41, 55, 0.8) 0%, rgba(17, 24, 39, 0.9) 100%)', borderColor: '#4F46E5' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div>
              <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', color: '#818CF8', fontWeight: '700', letterSpacing: '0.5px' }}>
                Your Standing
              </span>
              <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>
                Rank #{myRankInfo.myRank} <span style={{ color: 'var(--text-secondary)', fontSize: '1rem', fontWeight: '500' }}>• {myRankInfo.myScore} Points</span>
              </h2>
            </div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              From Redis <code>ZREVRANK</code> & <code>ZSCORE</code>
            </span>
          </div>

          {/* Surrounding Competitors Snippet */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${myRankInfo.context?.length || 1}, 1fr)`, gap: '0.5rem' }}>
            {myRankInfo.context?.map((item) => (
              <div
                key={item.userId}
                style={{
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-sm)',
                  background: item.isCurrent ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-tertiary)',
                  border: `1px solid ${item.isCurrent ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                  textAlign: 'center'
                }}
              >
                <div style={{ fontSize: '0.75rem', color: item.isCurrent ? '#A5B4FC' : 'var(--text-muted)', fontWeight: '700' }}>
                  #{item.rank} {item.isCurrent && '(YOU)'}
                </div>
                <div style={{ fontWeight: '700', fontSize: '0.9rem', color: item.isCurrent ? '#FFF' : 'var(--text-primary)' }}>
                  {item.username}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--accent-cyan)', fontWeight: '600' }}>
                  {item.score} pts
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem' }}>
        <button
          onClick={() => setActiveTab('global')}
          className={`btn ${activeTab === 'global' ? 'btn-primary' : 'btn-outline'}`}
          style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
        >
          🏆 Global Leaderboard (lb:global)
        </button>
        <button
          onClick={() => setActiveTab('colleges')}
          className={`btn ${activeTab === 'colleges' ? 'btn-primary' : 'btn-outline'}`}
          style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
        >
          🎓 University Rankings (lb:college)
        </button>
        <button
          onClick={() => setActiveTab('contest')}
          className={`btn ${activeTab === 'contest' ? 'btn-primary' : 'btn-outline'}`}
          style={{ padding: '0.45rem 1rem', fontSize: '0.85rem' }}
        >
          ⚡ Fall Grand Prix 2026 (lb:contest:1)
        </button>
      </div>

      {/* Leaderboard Table */}
      {activeTab === 'colleges' ? (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '80px' }}>Rank</th>
                <th>University / College</th>
                <th style={{ width: '140px', textAlign: 'right' }}>Aggregate Points</th>
              </tr>
            </thead>
            <tbody>
              {colleges.map((c) => (
                <tr key={c.college}>
                  <td className="font-mono" style={{ fontWeight: '700', color: c.rank <= 3 ? '#F59E0B' : 'inherit' }}>
                    {c.rank <= 3 ? ['🥇', '🥈', '🥉'][c.rank - 1] : `#${c.rank}`}
                  </td>
                  <td style={{ fontWeight: '600', fontSize: '0.95rem' }}>{c.college}</td>
                  <td className="font-mono" style={{ textAlign: 'right', fontWeight: '700', color: 'var(--accent-cyan)' }}>
                    {c.score.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="table-container">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '70px' }}>Rank</th>
                <th>Competitor</th>
                <th>University</th>
                <th style={{ width: '100px' }}>Rating</th>
                <th style={{ width: '90px' }}>Solved</th>
                <th style={{ width: '130px', textAlign: 'right' }}>Total Points</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    Loading leaderboard from Redis Sorted Set...
                  </td>
                </tr>
              ) : leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No scores recorded yet.
                  </td>
                </tr>
              ) : (
                leaderboard.map((entry) => {
                  const isHighlighted = recentUpdates.has(entry.userId);
                  const isCurrentUser = user && user.id === entry.userId.toString();
                  return (
                    <tr
                      key={entry.userId}
                      className={isHighlighted ? 'row-highlight' : ''}
                      style={{
                        backgroundColor: isCurrentUser ? 'rgba(99, 102, 241, 0.12)' : undefined
                      }}
                    >
                      <td className="font-mono" style={{ fontWeight: '700', color: entry.rank <= 3 ? '#F59E0B' : 'inherit' }}>
                        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `#${entry.rank}`}
                      </td>
                      <td style={{ fontWeight: '600' }}>
                        <span style={{ color: isCurrentUser ? '#A5B4FC' : '#FFF' }}>
                          {entry.username} {isCurrentUser && ' (You)'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{entry.college || '—'}</td>
                      <td className="font-mono" style={{ color: '#FCD34D' }}>{entry.rating}</td>
                      <td className="font-mono" style={{ color: 'var(--text-secondary)' }}>{entry.solved}</td>
                      <td className="font-mono" style={{ textAlign: 'right', fontWeight: '700', color: 'var(--accent-cyan)' }}>
                        {entry.score.toLocaleString()}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
