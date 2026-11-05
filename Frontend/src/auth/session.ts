export type UserRole = 'admin' | 'farmer' | 'staff' | 'guest';

export type SessionUser = {
  id?: string;
  fullName?: string;
  name?: string;
  email?: string;
  role?: UserRole;
  employerUserId?: string | null;
};

const STAFF_PATHS = new Set([
  '/dashboard/overview',
  '/dashboard/parameters',
  '/dashboard/feeding',
  '/dashboard/water-change',
  '/dashboard/alerts',
]);

export const readSessionUser = (): SessionUser | null => {
  try {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
};

export const readUserRole = (): UserRole => readSessionUser()?.role || 'farmer';

export const isStaffRole = (role: UserRole = readUserRole()): boolean => role === 'staff';

export const isAdminRole = (role: UserRole = readUserRole()): boolean => role === 'admin';

export const canAccessDashboardPath = (pathname: string, role: UserRole = readUserRole()): boolean => {
  if (role !== 'staff') return true;
  return [...STAFF_PATHS].some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

export const staffHomePath = '/dashboard/overview';
