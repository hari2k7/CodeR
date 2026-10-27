import React from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="navbar">
      <div className="nav-inner">
        <Link to="/" className="nav-brand">
          <span>CodeRank</span>
        </Link>

        <nav className="nav-links">
          <NavLink to="/problems" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            Problems
          </NavLink>
          <NavLink to="/leaderboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
            Leaderboard
          </NavLink>
          {isAuthenticated && (
            <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              Profile
            </NavLink>
          )}
        </nav>

        <div className="nav-user">
          {isAuthenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
              <Link to="/profile" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366F1 0%, #06B6D4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: '700',
                  fontSize: '0.85rem'
                }}>
                  {user.username ? user.username[0].toUpperCase() : 'U'}
                </span>
                <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{user.username}</span>
              </Link>
              <button onClick={handleLogout} className="btn btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}>
                Sign Out
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Link to="/login" className="btn btn-outline" style={{ padding: '0.45rem 0.9rem' }}>
                Sign In
              </Link>
              <Link to="/register" className="btn btn-primary" style={{ padding: '0.45rem 0.9rem' }}>
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
