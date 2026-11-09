export type UserRole = 'admin' | 'farmer' | 'staff' | 'guest';

export const USER_ROLES: UserRole[] = ['admin', 'farmer', 'staff', 'guest'];

/** Staff may view readings and run feed / drain / fill only. */
export const STAFF_HARDWARE_ACTIONS = new Set(['DRAIN', 'FILL', 'WATER_EXCHANGE', 'FILL_TO_TARGET', 'WATER_STOP']);
