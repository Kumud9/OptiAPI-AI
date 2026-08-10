import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const initializeAuth = async () => {
      const storedToken = localStorage.getItem('optiapi_token');
      const storedUser = localStorage.getItem('optiapi_user');

      if (storedToken && storedUser) {
        try {
          setUser(JSON.parse(storedUser));
          // Optionally verify token freshness on server
          const response = await api.get('/auth/me');
          if (response.data.success) {
            const freshUser = { ...response.data.data, token: storedToken };
            setUser(freshUser);
            localStorage.setItem('optiapi_user', JSON.stringify(freshUser));
          }
        } catch (error) {
          console.error('Session validation failed:', error.message);
          logout();
        }
      }
      setLoading(false);
    };

    initializeAuth();
  }, []);

  const login = async (email, password) => {
    setLoading(true);
    try {
      const response = await api.post('/auth/login', { email, password });
      if (response.data.success) {
        const userData = response.data.data;
        localStorage.setItem('optiapi_token', userData.token);
        localStorage.setItem('optiapi_user', JSON.stringify(userData));
        setUser(userData);
        setLoading(false);
        return { success: true };
      }
    } catch (error) {
      setLoading(false);
      return {
        success: false,
        error: error.response?.data?.error || 'Authentication failed'
      };
    }
  };

  const register = async (email, password, organization) => {
    setLoading(true);
    try {
      const response = await api.post('/auth/register', { email, password, organization });
      if (response.data.success) {
        const userData = response.data.data;
        localStorage.setItem('optiapi_token', userData.token);
        localStorage.setItem('optiapi_user', JSON.stringify(userData));
        setUser(userData);
        setLoading(false);
        return { success: true };
      }
    } catch (error) {
      setLoading(false);
      return {
        success: false,
        error: error.response?.data?.error || 'Registration failed'
      };
    }
  };

  const logout = () => {
    localStorage.removeItem('optiapi_token');
    localStorage.removeItem('optiapi_user');
    setUser(null);
  };

  const updateProfile = async (organization, password) => {
    try {
      const response = await api.put('/users/profile', { organization, password });
      if (response.data.success) {
        const updatedUser = { ...user, organization: response.data.data.organization };
        localStorage.setItem('optiapi_user', JSON.stringify(updatedUser));
        setUser(updatedUser);
        return { success: true };
      }
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || 'Failed to update profile'
      };
    }
  };

  const value = {
    user,
    loading,
    login,
    register,
    logout,
    updateProfile
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be executed within an AuthProvider scope');
  }
  return context;
};
export default AuthContext;
