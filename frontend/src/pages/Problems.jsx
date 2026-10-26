import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { problemsAPI } from '../api.js';

export default function Problems() {
  const [problems, setProblems] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedTags, setSelectedTags] = useState([]);
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [mode, setMode] = useState('all'); // 'all' (SINTER) or 'any' (SUNION)
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Load available tags with Redis set counts
  useEffect(() => {
    async function loadTags() {
      try {
        const res = await problemsAPI.tags();
        if (res?.tags) setTags(res.tags);
      } catch (err) {
        console.error('Failed to load tags:', err);
      }
    }
    loadTags();
  }, []);

  // Fetch problems on filter changes
  useEffect(() => {
    async function fetchProblems() {
      setLoading(true);
      try {
        if (searchQuery.trim().length > 1) {
          const res = await problemsAPI.search(searchQuery.trim());
          setProblems(res?.problems || []);
          setTotalCount(res?.total || 0);
        } else {
          const res = await problemsAPI.list({
            tags: selectedTags.join(','),
            difficulty: selectedDifficulty,
            mode,
            limit: 50
          });
          setProblems(res?.problems || []);
          setTotalCount(res?.total || 0);
        }
      } catch (err) {
        console.error('Failed to fetch problems:', err);
      } finally {
        setLoading(false);
      }
    }

    const debounce = setTimeout(fetchProblems, 200);
    return () => clearTimeout(debounce);
  }, [selectedTags, selectedDifficulty, mode, searchQuery]);

  const toggleTag = (tagName) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: '800', letterSpacing: '-0.5px' }}>
            Problem Catalog
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Filter using native Redis Set operations (<code>SINTER</code> / <code>SUNION</code>)
          </p>
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Showing <strong>{problems.length}</strong> of <strong>{totalCount}</strong> problems
        </div>
      </div>

      {/* Filter Controls Card */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', marginBottom: '1rem' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search problems by title, keywords or statement..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
              Tag Filter Mode:
            </span>
            <button
              onClick={() => setMode('all')}
              className={`btn ${mode === 'all' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
              title="Redis SINTER: Requires ALL selected tags"
            >
              ALL (SINTER)
            </button>
            <button
              onClick={() => setMode('any')}
              className={`btn ${mode === 'any' ? 'btn-primary' : 'btn-outline'}`}
              style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
              title="Redis SUNION: Requires AT LEAST ONE tag"
            >
              ANY (SUNION)
            </button>
          </div>
        </div>

        {/* Difficulty Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>Difficulty:</span>
          {['', 'easy', 'medium', 'hard'].map((diff) => (
            <button
              key={diff}
              onClick={() => setSelectedDifficulty(diff)}
              className={`btn ${selectedDifficulty === diff ? 'btn-secondary' : 'btn-outline'}`}
              style={{
                padding: '0.25rem 0.75rem',
                fontSize: '0.8rem',
                textTransform: 'capitalize',
                borderColor: selectedDifficulty === diff ? 'var(--accent-primary)' : 'var(--border-subtle)'
              }}
            >
              {diff || 'All Levels'}
            </button>
          ))}
        </div>

        {/* Tag Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '600' }}>Tags:</span>
          {tags.map((t) => {
            const isSelected = selectedTags.includes(t.name);
            return (
              <span
                key={t.name}
                onClick={() => toggleTag(t.name)}
                className={`badge-tag ${isSelected ? 'selected' : ''}`}
              >
                {t.name} ({t.count})
              </span>
            );
          })}
          {selectedTags.length > 0 && (
            <button
              onClick={() => setSelectedTags([])}
              style={{ background: 'none', border: 'none', color: '#F43F5E', fontSize: '0.75rem', cursor: 'pointer', marginLeft: '0.5rem' }}
            >
              Clear Tags ✕
            </button>
          )}
        </div>
      </div>

      {/* Problems Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '60px' }}>#</th>
              <th>Problem Title</th>
              <th style={{ width: '130px' }}>Difficulty</th>
              <th style={{ width: '90px' }}>Points</th>
              <th>Tags</th>
              <th style={{ width: '100px', textAlign: 'center' }}>Status</th>
              <th style={{ width: '100px', textAlign: 'right' }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  Loading problems from Redis...
                </td>
              </tr>
            ) : problems.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                  No problems matched the current Redis set intersection query.
                </td>
              </tr>
            ) : (
              problems.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono" style={{ color: 'var(--text-muted)' }}>
                    #{p.id}
                  </td>
                  <td>
                    <Link to={`/problems/${p.id}`} style={{ fontWeight: '600', color: '#FFF' }}>
                      {p.title}
                    </Link>
                  </td>
                  <td>
                    <span className={`badge badge-${p.difficulty}`}>
                      {p.difficulty}
                    </span>
                  </td>
                  <td className="font-mono" style={{ fontWeight: '600', color: 'var(--accent-cyan)' }}>
                    {p.points}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                      {p.tags?.map((tag) => (
                        <span key={tag} className="badge-tag" style={{ cursor: 'default' }}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {p.solved ? (
                      <span style={{ color: '#10B981', fontWeight: '700', fontSize: '1.1rem' }} title="Solved by you!">
                        ✓
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>—</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Link to={`/problems/${p.id}`} className="btn btn-secondary" style={{ padding: '0.3rem 0.75rem', fontSize: '0.8rem' }}>
                      Solve
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
