import React, { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('coderank_token'));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      if (token) {
        try {
          const res = await authAPI.getMe();
          if (res?.user) {
            setUser(res.user);
          } else {
            handleLogout();
          }
        } catch (err) {
          handleLogout();
        }
      }
      setLoading(false);
    }
    loadUser();
  }, [token]);

  const handleLogin = (newToken, userData) => {
    localStorage.setItem('coderank_token', newToken);
    setToken(newToken);
    setUser(userData);
  };

  const handleLogout = async () => {
    try {
      if (token) await authAPI.logout();
    } catch {}
    localStorage.removeItem('coderank_token');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        isAuthenticated: !!user,
        login: handleLogin,
        logout: handleLogout,
        setUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
