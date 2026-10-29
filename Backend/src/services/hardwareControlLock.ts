import type { Transaction } from 'sequelize';
import { getDatabase } from '../database/connection';

export class DeviceStopPendingError extends Error {
  constructor() {
    super('A device stop must be acknowledged or terminal before a new start');
    this.name = 'DeviceStopPendingError';
  }
}

/** Serialize actuator queueing, stop barriers, and device polling per owner/device. */
export const withHardwareDeviceLock = <T>(userId: string, deviceId: string,
  work: (transaction: Transaction) => Promise<T>): Promise<T> => {
  const database = getDatabase();
  return database.transaction(async (transaction) => {
    await database.query('SELECT pg_advisory_xact_lock(hashtextextended(:lockKey, 0))', {
      replacements: { lockKey: `hardware-control:${userId}:${deviceId}` }, transaction,
    });
    return work(transaction);
  });
};
