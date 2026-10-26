import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { problemsAPI, submissionsAPI } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function ProblemDetail() {
  const { id } = useParams();
  const { isAuthenticated, user } = useAuth();

  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(
    '// Write your solution here\n#include <iostream>\n\nint main() {\n    // Optimal algorithm\n    return 0;\n}'
  );

  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState(null);
  const [pollInterval, setPollInterval] = useState(null);

  // Load problem details
  useEffect(() => {
    async function loadProblem() {
      setLoading(true);
      try {
        const res = await problemsAPI.get(id);
        if (res?.problem) setProblem(res.problem);
      } catch (err) {
        setError(err.message || 'Problem not found');
      } finally {
        setLoading(false);
      }
    }
    loadProblem();
  }, [id]);

  // Clean up polling interval
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [pollInterval]);

  const handleSubmit = async () => {
    if (!isAuthenticated) return;
    setError(null);
    setSubmitting(true);
    setSubmission(null);

    try {
      const res = await submissionsAPI.submit({
        problemId: parseInt(id, 10),
        code,
        language
      });

      setSubmission({
        id: res.submissionId,
        status: res.status,
        verdict: res.verdict
      });

      // Start polling for verdict resolution
      const interval = setInterval(async () => {
        try {
          const check = await submissionsAPI.get(res.submissionId);
          if (check?.submission) {
            setSubmission(check.submission);
            if (check.submission.status === 'COMPLETED') {
              clearInterval(interval);
              setSubmitting(false);
            }
          }
        } catch (pollErr) {
          clearInterval(interval);
          setSubmitting(false);
        }
      }, 700);

      setPollInterval(interval);
    } catch (err) {
      setError(err.message || 'Submission failed');
      setSubmitting(false);
    }
  };

  const insertTemplate = (type) => {
    if (type === 'AC') {
      setCode(`// AC - Guaranteed Optimal Solution\n#include <iostream>\n\nint main() {\n    std::cout << "Optimal result calculated atomically in Redis" << std::endl;\n    return 0;\n}`);
    } else if (type === 'WA') {
      setCode(`// WA - Deliberately Incorrect Solution\n#include <iostream>\n\nint main() {\n    std::cout << "Wrong output" << std::endl;\n    return 0;\n}`);
    } else if (type === 'TLE') {
      setCode(`// TLE - Time Limit Exceeded Demo\n#include <iostream>\n#include <thread>\n#include <chrono>\n\nint main() {\n    std::this_thread::sleep_for(std::chrono::seconds(5));\n    return 0;\n}`);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '4rem' }}>Loading problem from Redis...</div>;
  }

  if (error || !problem) {
    return (
      <div className="card" style={{ maxWidth: '600px', margin: '2rem auto', textAlign: 'center' }}>
        <h2>Problem Not Found</h2>
        <p style={{ color: 'var(--text-secondary)', margin: '1rem 0' }}>{error || 'Unable to load problem details.'}</p>
        <Link to="/problems" className="btn btn-primary">Back to Catalog</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
      {/* Left Column: Problem Statement & Specs */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '1.4rem', fontWeight: '800' }}>#{problem.id}. {problem.title}</span>
            <span className={`badge badge-${problem.difficulty}`}>{problem.difficulty}</span>
          </div>
          <span style={{ fontWeight: '700', color: 'var(--accent-cyan)', fontSize: '1.1rem' }}>
            {problem.points} PTS
          </span>
        </div>

        {problem.solved && (
          <div style={{
            background: 'var(--status-ac-bg)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: 'var(--status-ac)',
            padding: '0.65rem 1rem',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: '600',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <span>✓</span> You have already solved this problem! Additional ACs will not double-count score.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {problem.tags?.map((t) => (
            <span key={t} className="badge-tag">{t}</span>
          ))}
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem',
          background: 'var(--bg-tertiary)',
          padding: '0.85rem 1.25rem',
          borderRadius: 'var(--radius-sm)',
          marginBottom: '1.5rem',
          fontSize: '0.85rem'
        }}>
          <div>⏱ Time Limit: <strong>{problem.timeLimit} ms</strong></div>
          <div>💾 Memory Limit: <strong>{problem.memoryLimit} MB</strong></div>
        </div>

        <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.5rem' }}>Problem Description</h3>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
          {problem.statement}
        </p>

        <h3 style={{ fontSize: '1rem', fontWeight: '700', marginBottom: '0.5rem' }}>Input / Output Specification</h3>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '1rem' }}>
          Standard competitive programming I/O. Read from standard input, write to standard output.
        </p>
      </div>

      {/* Right Column: Code Editor & Submission Flow */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: '700' }}>Submit Solution</h3>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select
              className="form-select"
              style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="cpp">C++ (GCC 14)</option>
              <option value="python">Python 3.12</option>
              <option value="java">Java 21</option>
              <option value="rust">Rust 1.78</option>
            </select>
          </div>
        </div>

        {/* Demo Test Templates */}
        <div style={{ marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Demo Code Presets:</span>
          <button
            type="button"
            onClick={() => insertTemplate('AC')}
            className="btn btn-outline"
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: 'var(--status-ac)', borderColor: 'rgba(16, 185, 129, 0.4)' }}
          >
            + Force AC
          </button>
          <button
            type="button"
            onClick={() => insertTemplate('WA')}
            className="btn btn-outline"
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: 'var(--status-wa)', borderColor: 'rgba(244, 63, 94, 0.4)' }}
          >
            + Force WA
          </button>
          <button
            type="button"
            onClick={() => insertTemplate('TLE')}
            className="btn btn-outline"
            style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', color: 'var(--status-tle)', borderColor: 'rgba(245, 158, 11, 0.4)' }}
          >
            + Force TLE
          </button>
        </div>

        {/* Code Textarea */}
        <textarea
          className="form-textarea font-mono"
          style={{
            height: '280px',
            resize: 'vertical',
            fontSize: '0.9rem',
            lineHeight: 1.5,
            backgroundColor: '#0D1117',
            borderColor: '#30363D'
          }}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />

        {error && (
          <div className="banner-lockout" style={{ marginTop: '1rem', marginBottom: '0' }}>
            <span>⚠️</span>
            <span style={{ fontSize: '0.85rem' }}>{error}</span>
          </div>
        )}

        {/* Action Button */}
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
          {!isAuthenticated ? (
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Please <Link to="/login" style={{ color: 'var(--accent-primary)', fontWeight: '600' }}>sign in</Link> to submit code.
            </div>
          ) : (
            <button
              onClick={handleSubmit}
              className="btn btn-primary"
              disabled={submitting}
              style={{ minWidth: '160px' }}
            >
              {submitting ? 'Judging Stream...' : 'Submit to Queue'}
            </button>
          )}
        </div>

        {/* Live Submission Status Card */}
        {submission && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1.25rem',
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-subtle)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Submission #{submission.id}
              </span>
              <span className={`badge ${
                submission.status === 'COMPLETED'
                  ? (submission.verdict === 'AC' ? 'badge-ac' : submission.verdict === 'WA' ? 'badge-wa' : 'badge-tle')
                  : 'badge-pending'
              }`}>
                {submission.status === 'COMPLETED' ? submission.verdict : submission.status}
              </span>
            </div>

            {submission.status !== 'COMPLETED' ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="live-dot" />
                Stream worker evaluating code on consumer group...
              </div>
            ) : (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', fontSize: '0.8rem', marginTop: '0.5rem' }}>
                  <div>Points: <strong style={{ color: submission.points > 0 ? 'var(--status-ac)' : 'inherit' }}>+{submission.points}</strong></div>
                  <div>Time: <strong>{submission.executionTime} ms</strong></div>
                  <div>Memory: <strong>{submission.memory} MB</strong></div>
                </div>
                {submission.verdict === 'AC' && submission.points > 0 && (
                  <div style={{ marginTop: '0.75rem', color: 'var(--status-ac)', fontSize: '0.85rem', fontWeight: '600' }}>
                    🎉 Accepted! Atomic Lua scoring updated your global rank!
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
