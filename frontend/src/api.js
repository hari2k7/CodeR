const API_BASE = '';

/**
 * Universal request wrapper adding token and unwrapping standard error responses
 */
export async function request(endpoint, options = {}) {
  const token = localStorage.getItem('coderank_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const errorObj = data?.error || {
      code: `HTTP_${response.status}`,
      message: data?.message || response.statusText || 'Request failed'
    };
    const error = new Error(errorObj.message);
    error.code = errorObj.code;
    error.retryAfter = errorObj.retryAfter;
    error.status = response.status;
    throw error;
  }

  // Also extract custom headers if needed (such as X-Cache)
  if (data && typeof data === 'object' && response.headers.get('x-cache')) {
    data._cacheHeader = response.headers.get('x-cache');
  }

  return data;
}

export const authAPI = {
  register: (body) => request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  verifyOtp: (body) => request('/auth/verify-otp', { method: 'POST', body: JSON.stringify(body) }),
  resendOtp: (email) => request('/auth/resend-otp', { method: 'POST', body: JSON.stringify({ email }) }),
  login: (identifier, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ identifier, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),
  updateProfile: (body) => request('/auth/me', { method: 'PUT', body: JSON.stringify(body) }),
  deleteAccount: () => request('/auth/me', { method: 'DELETE' })
};

export const problemsAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.tags) qs.set('tags', params.tags);
    if (params.difficulty) qs.set('difficulty', params.difficulty);
    if (params.mode) qs.set('mode', params.mode);
    if (params.limit) qs.set('limit', params.limit);
    if (params.offset) qs.set('offset', params.offset);
    return request(`/problems?${qs.toString()}`);
  },
  tags: () => request('/problems/tags'),
  search: (q) => request(`/problems/search?q=${encodeURIComponent(q)}`),
  get: (id) => request(`/problems/${id}`)
};

export const submissionsAPI = {
  submit: (body) => request('/submissions', { method: 'POST', body: JSON.stringify(body) }),
  get: (id) => request(`/submissions/${id}`),
  list: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.userId) qs.set('userId', params.userId);
    if (params.limit) qs.set('limit', params.limit);
    if (params.offset) qs.set('offset', params.offset);
    return request(`/submissions?${qs.toString()}`);
  }
};

export const leaderboardAPI = {
  get: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', params.limit);
    if (params.offset) qs.set('offset', params.offset);
    if (params.contestId) qs.set('contestId', params.contestId);
    return request(`/leaderboard?${qs.toString()}`);
  },
  me: () => request('/leaderboard/me'),
  colleges: () => request('/leaderboard/colleges'),
  contests: () => request('/leaderboard/contests')
};

export const statsAPI = {
  getStats: () => request('/stats'),
  getStreak: (userId) => request(`/stats/streak/${userId}`)
};
