export const parseJwt = (token: string | null) => {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = parts[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return decoded;
  } catch (err) {
    return null;
  }
};

export const isTokenValid = (token: string | null) => {
  const p = parseJwt(token);
  if (!p) return false;
  if (p.exp && typeof p.exp === 'number') {
    const now = Math.floor(Date.now() / 1000);
    return p.exp > now;
  }
  return true;
};

export const getUserFromToken = (token: string | null) => {
  const p = parseJwt(token);
  if (!p) return null;
  return { id: p.id, role: p.role, email: p.email, name: p.name } as any;
};

// Ensures only one role is active in this browser at a time.
// If a different role is already stored, prompt the user to confirm switching.
export const ensureSingleRole = (newRole: 'student' | 'examiner' | 'admin') => {
  const existingRaw = localStorage.getItem('user');
  if (!existingRaw) return true;
  try {
    const existing = JSON.parse(existingRaw);
    const existingRole = existing?.role;
    if (!existingRole || existingRole === newRole) return true;

    const confirmed = window.confirm(
      `You are currently logged in as ${existingRole}. Logging in as ${newRole} will sign you out from the ${existingRole} account. Continue?`
    );
    if (!confirmed) return false;

    // Clear any role-specific keys from previous role
    if (existingRole === 'student') {
      localStorage.removeItem('studentId');
      localStorage.removeItem('studentEmail');
    }

    // Generic cleanup of previous auth data
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    return true;
  } catch (err) {
    // If parsing fails, clear potentially corrupted data and proceed
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return true;
  }
};