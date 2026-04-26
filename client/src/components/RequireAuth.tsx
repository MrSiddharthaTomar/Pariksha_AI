import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getToken } from '@/lib/api-config';
import { isTokenValid, getUserFromToken } from '@/lib/auth';

const RequireAuth = ({ children, role }: { children: JSX.Element; role?: 'student' | 'examiner' | 'admin' }) => {
  const location = useLocation();
  const token = getToken();
  if (!token || !isTokenValid(token)) {
    // token missing or expired
    const fallback = role === 'examiner' ? '/examiner/login' : role === 'admin' ? '/admin/login' : '/student/login';
    return <Navigate to={fallback} state={{ from: location }} replace />;
  }

  if (role) {
    const user = getUserFromToken(token);
    if (!user || user.role !== role) {
      // role mismatch
      const fallback = role === 'examiner' ? '/examiner/login' : role === 'admin' ? '/admin/login' : '/student/login';
      return <Navigate to={fallback} state={{ from: location }} replace />;
    }
  }

  return children;
};

export default RequireAuth;