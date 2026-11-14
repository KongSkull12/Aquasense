export type UserRole = 'admin' | 'farmer' | 'staff' | 'guest';

export const USER_ROLES: UserRole[] = ['admin', 'farmer', 'staff', 'guest'];

/** Staff may view readings, feed, drain / fill, and switch the aerator only. */
export const STAFF_HARDWARE_ACTIONS = new Set([
  'DRAIN', 'FILL', 'WATER_EXCHANGE', 'FILL_TO_TARGET', 'DRAIN_TO_TARGET', 'WATER_STOP',
  'AERATOR_ON', 'AERATOR_OFF', 'AERATOR_AUTO',
]);

/**
 * Accounts an owner creates for others. A viewer is stored as the read-only
 * `guest` role, so no database enum change is needed; read routes already
 * allow `guest` and every write route rejects it.
 */
export type SubAccountRole = 'staff' | 'guest';
export type SubAccountAccess = 'staff' | 'viewer';

export const SUB_ACCOUNT_ROLES: SubAccountRole[] = ['staff', 'guest'];

export const subAccountRoleFor = (access: SubAccountAccess | undefined): SubAccountRole =>
  access === 'viewer' ? 'guest' : 'staff';

export const isSubAccountRole = (role: UserRole | undefined): role is SubAccountRole =>
  role === 'staff' || role === 'guest';

/** Owners who may create staff and viewer accounts for their own tank. */
export const canManageSubAccounts = (role: UserRole | undefined): boolean =>
  role === 'admin' || role === 'farmer';
