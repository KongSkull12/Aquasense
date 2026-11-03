import { mock } from 'node:test';
import { Device } from '../database/models/Device';
import { User } from '../database/models/User';

export type TestUser = { id: string; role: 'admin' | 'farmer' | 'staff' | 'guest'; employerUserId?: string | null };
export type TestDevice = { deviceId: string; userId: string; isActive: boolean };

const matches = (where: Record<string, unknown>) => (row: TestDevice) =>
  Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);

/**
 * Serves the User and Device lookups behind deviceAccess from in-memory rows,
 * so tests exercise the real access rules without a database. Pass an array
 * that the test mutates to change ownership mid-test.
 */
export const mockDeviceAccess = (users: TestUser[], devices: TestDevice[]): void => {
  mock.method(User, 'findByPk', async (id: string) => users.find((user) => user.id === id) ?? null);
  mock.method(Device, 'findAll', async ({ where }: { where: Record<string, unknown> }) => devices.filter(matches(where)));
  mock.method(Device, 'findOne', async ({ where }: { where: Record<string, unknown> }) => devices.find(matches(where)) ?? null);
};
