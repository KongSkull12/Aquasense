import { Device } from '../database/models/Device';
import { User } from '../database/models/User';
import type { UserRole } from './userRoles';

const activeDevices = (where: { userId?: string }): Promise<Device[]> =>
  Device.findAll({ where: { ...where, isActive: true }, order: [['createdAt', 'DESC']] });

/** Devices this account may see and operate. Staff inherit the employer's tank. */
export const listAccessibleDevices = async (userId: string, role?: UserRole): Promise<Device[]> => {
  const user = await User.findByPk(userId);
  if (!user) return [];
  const effectiveRole = role || user.role;

  if (effectiveRole === 'admin') {
    return activeDevices({});
  }

  if (effectiveRole === 'staff') {
    if (!user.employerUserId) return [];
    const employer = await User.findByPk(user.employerUserId);
    if (!employer) return [];
    if (employer.role === 'admin') return activeDevices({});
    return activeDevices({ userId: employer.id });
  }

  return activeDevices({ userId });
};

export const verifyDeviceAccess = async (userId: string, deviceId: string, role?: UserRole): Promise<boolean> => {
  if (!deviceId) return false;
  const devices = await listAccessibleDevices(userId, role);
  return devices.some((device) => device.deviceId === deviceId);
};

/**
 * Commands and MQTT acks are stored under the device owner. Staff act on that
 * owner's record so the ESP32 handshake still matches.
 */
export const resolveCommandOwnerUserId = async (userId: string, deviceId: string, role?: UserRole): Promise<string | null> => {
  if (!(await verifyDeviceAccess(userId, deviceId, role))) return null;
  const device = await Device.findOne({ where: { deviceId, isActive: true } });
  return device?.userId || null;
};

export const accessibleDeviceIds = async (userId: string, role?: UserRole): Promise<string[] | undefined> => {
  if (role === 'admin' || (await User.findByPk(userId))?.role === 'admin') return undefined;
  return (await listAccessibleDevices(userId, role)).map((device) => device.deviceId);
};
