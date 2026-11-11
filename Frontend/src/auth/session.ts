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
  '/dashboard/aerator',
  '/dashboard/alerts',
]);

/** Viewer accounts (stored as `guest`) see readings and alerts only. */
const VIEWER_PATHS = new Set([
  '/dashboard/overview',
  '/dashboard/parameters',
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

export const isViewerRole = (role: UserRole = readUserRole()): boolean => role === 'guest';

/** Staff and viewer accounts belong to a farm owner and see a reduced dashboard. */
export const isSubAccountRole = (role: UserRole = readUserRole()): boolean => role === 'staff' || role === 'guest';

export const isAdminRole = (role: UserRole = readUserRole()): boolean => role === 'admin';

/** Farm owners (admin or farmer) can create staff and viewer accounts. */
export const canManageSubAccounts = (role: UserRole = readUserRole()): boolean => role === 'admin' || role === 'farmer';

export const canAccessDashboardPath = (pathname: string, role: UserRole = readUserRole()): boolean => {
  const allowed = role === 'staff' ? STAFF_PATHS : role === 'guest' ? VIEWER_PATHS : null;
  if (!allowed) return true;
  return [...allowed].some((path) => pathname === path || pathname.startsWith(`${path}/`));
};

export const staffHomePath = '/dashboard/overview';
