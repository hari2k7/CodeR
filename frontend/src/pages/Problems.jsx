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

    const debounce = setTimeout(fetchProblems, 150);
    return () => clearTimeout(debounce);
  }, [selectedTags, selectedDifficulty, mode, searchQuery]);

  const toggleTag = (tagName) => {
    setSelectedTags((prev) =>
      prev.includes(tagName) ? prev.filter((t) => t !== tagName) : [...prev, tagName]
    );
  };

  return (
    <div>
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.85rem', fontWeight: '800', letterSpacing: '-0.5px' }}>
            Problem Catalog
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.2rem' }}>
            Filter using native Redis Set operations (<code>SINTER</code> intersection vs <code>SUNION</code> union)
          </p>
        </div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Showing <strong>{problems.length}</strong> of <strong>{totalCount}</strong> problems
        </div>
      </div>

      {/* Filter Controls Card */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        {/* Search Bar */}
        <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
          <input
            type="text"
            className="form-input"
            placeholder="Search problems by title, keywords or statement..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', paddingRight: searchQuery ? '4.5rem' : '1rem' }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: '0.8rem'
              }}
            >
              Clear ✕
            </button>
          )}
          {searchQuery.trim().length > 1 && (
            <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginTop: '0.35rem' }}>
              🔍 Full-text search is active (overrides tag filters). Clear search to use Redis Set filters.
            </div>
          )}
        </div>

        {/* Difficulty Filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
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

        {/* Tag Filter Section with Mode Controls directly attached */}
        <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: '#FFF', fontWeight: '700' }}>
                Tags ({selectedTags.length} selected):
              </span>
              {selectedTags.length > 0 && (
                <button
                  onClick={() => setSelectedTags([])}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#F43F5E',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    fontWeight: '600'
                  }}
                >
                  Clear Tags ✕
                </button>
              )}
            </div>

            {/* Set Operation Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: '600' }}>
                Set Operation:
              </span>
              <button
                onClick={() => setMode('all')}
                className={`btn ${mode === 'all' ? 'btn-primary' : 'btn-outline'}`}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: mode === 'all' ? '700' : '500'
                }}
                title="Redis SINTER: Requires ALL selected tags (Intersection - AND)"
              >
                ALL (SINTER ∩)
              </button>
              <button
                onClick={() => setMode('any')}
                className={`btn ${mode === 'any' ? 'btn-primary' : 'btn-outline'}`}
                style={{
                  padding: '0.35rem 0.75rem',
                  fontSize: '0.75rem',
                  fontWeight: mode === 'any' ? '700' : '500'
                }}
                title="Redis SUNION: Requires AT LEAST ONE tag (Union - OR)"
              >
                ANY (SUNION ∪)
              </button>
            </div>
          </div>

          {/* Tag Pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {tags.map((t) => {
              const isSelected = selectedTags.includes(t.name);
              return (
                <span
                  key={t.name}
                  onClick={() => toggleTag(t.name)}
                  className={`badge-tag ${isSelected ? 'selected' : ''}`}
                  style={{
                    cursor: 'pointer',
                    backgroundColor: isSelected ? 'var(--accent-primary)' : undefined,
                    color: isSelected ? '#FFF' : undefined,
                    borderColor: isSelected ? 'var(--accent-primary)' : undefined
                  }}
                >
                  {isSelected ? '✓ ' : ''}{t.name} ({t.count})
                </span>
              );
            })}
          </div>

          {/* Redis Command Banner */}
          {selectedTags.length > 0 && (
            <div
              style={{
                padding: '0.75rem 1rem',
                backgroundColor: 'var(--bg-tertiary)',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.8rem'
              }}
            >
              {selectedTags.length === 1 ? (
                <div style={{ color: 'var(--accent-cyan)' }}>
                  ℹ️ <strong>1 tag selected (<code>{selectedTags[0]}</code>):</strong> In mathematics and Redis, the intersection (<code>SINTER</code>) and union (<code>SUNION</code>) of a <em>single set</em> are identical ({totalCount} problems). <strong>Select a 2nd tag</strong> to see set intersection vs union in action!
                </div>
              ) : (
                <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <span style={{ color: mode === 'all' ? '#10B981' : '#F59E0B', fontWeight: '700' }}>
                      ⚡ Redis Command Executed:{' '}
                    </span>
                    <code style={{ color: '#FFF', fontWeight: '600' }}>
                      {mode === 'all' ? 'SINTER' : 'SUNION'}{' '}
                      {selectedDifficulty ? `difficulty:${selectedDifficulty} ` : ''}
                      {selectedTags.map((t) => `tag:${t}`).join(' ')}
                    </code>
                  </div>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: '600' }}>
                    Result: <strong style={{ color: '#FFF' }}>{totalCount}</strong> problems
                  </span>
                </div>
                <div style={{ marginTop: '0.35rem', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                  {mode === 'all' ? (
                    <span>
                      🎯 <strong>ALL (Intersection):</strong> Returns problems containing <strong>EVERY</strong> selected tag ({selectedTags.join(' AND ')}).
                    </span>
                  ) : (
                    <span>
                      🌐 <strong>ANY (Union):</strong> Returns problems containing <strong>AT LEAST ONE</strong> selected tag ({selectedTags.join(' OR ')}).
                    </span>
                  )}
                </div>
              </div>
            )}
            </div>
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
                  {selectedTags.length >= 2 && mode === 'all' ? (
                    <div>
                      <div style={{ color: '#FFF', fontWeight: '600', marginBottom: '0.3rem' }}>
                        No problems have ALL selected tags simultaneously.
                      </div>
                      <div style={{ fontSize: '0.85rem' }}>
                        Try switching to <button onClick={() => setMode('any')} className="btn btn-outline" style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', display: 'inline-flex' }}>ANY (SUNION)</button> to see problems having at least one of these tags!
                      </div>
                    </div>
                  ) : (
                    'No problems matched the current filter criteria.'
                  )}
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
                      {p.tags?.map((tag) => {
                        const isMatched = selectedTags.includes(tag);
                        return (
                          <span
                            key={tag}
                            className={`badge-tag ${isMatched ? 'selected' : ''}`}
                            style={{
                              cursor: 'pointer',
                              backgroundColor: isMatched ? 'var(--accent-primary)' : undefined,
                              color: isMatched ? '#FFF' : undefined,
                              borderColor: isMatched ? 'var(--accent-primary)' : undefined
                            }}
                            onClick={() => toggleTag(tag)}
                            title="Click to toggle tag filter"
                          >
                            {tag}
                          </span>
                        );
                      })}
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

