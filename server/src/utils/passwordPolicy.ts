export const PASSWORD_POLICY_MESSAGE =
  'Password must be at least 12 characters and include uppercase, lowercase, number, and special character.';

export const isStrongPassword = (password: string): boolean => {
  if (typeof password !== 'string') return false;
  if (password.length < 12) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[^A-Za-z0-9]/.test(password)) return false;
  return true;
};

