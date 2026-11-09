import { Device } from '../database/models/Device';

class DeviceService {
  async listByUser(userId: string): Promise<Device[]> {
    return Device.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
    });
  }

  async registerDevice(userId: string, deviceId: string, name?: string): Promise<Device> {
    const existing = await Device.findOne({ where: { deviceId } });
    if (existing && existing.userId !== userId) {
      throw new Error('Device ID is already registered to another user');
    }
    if (existing && existing.userId === userId) {
      existing.isActive = true;
      if (name && name.trim()) {
        existing.name = name.trim();
      }
      await existing.save();
      return existing;
    }

    return Device.create({
      userId,
      deviceId,
      name: (name || `Device ${deviceId}`).trim(),
      isActive: true,
    });
  }

  async deactivateDevice(userId: string, deviceId: string): Promise<boolean> {
    const [updatedCount] = await Device.update(
      { isActive: false },
      {
        where: {
          userId,
          deviceId,
          isActive: true,
        },
      }
    );
    return updatedCount > 0;
  }

  async ensureOwnedDevice(userId: string, deviceId: string): Promise<Device> {
    const existing = await Device.findOne({ where: { userId, deviceId } });
    if (existing) {
      return existing;
    }

    return Device.create({
      userId,
      deviceId,
      name: `Device ${deviceId}`,
      isActive: true,
    });
  }

  async verifyOwnership(userId: string, deviceId: string): Promise<boolean> {
    const owned = await Device.findOne({ where: { userId, deviceId, isActive: true } });
    return Boolean(owned);
  }

  async getActiveDevice(deviceId: string): Promise<Device | null> {
    return Device.findOne({ where: { deviceId, isActive: true } });
  }
}

export const deviceService = new DeviceService();
