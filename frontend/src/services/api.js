const VITE_API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api/v1';

import axios from 'axios';

const api = axios.create({
  baseURL: VITE_API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor injecting JWT bearer tokens
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('optiapi_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to intercept unauthenticated requests (expired JWTs)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('optiapi_token');
      localStorage.removeItem('optiapi_user');
      if (window.location.pathname !== '/login' && window.location.pathname !== '/' && window.location.pathname !== '/register') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
