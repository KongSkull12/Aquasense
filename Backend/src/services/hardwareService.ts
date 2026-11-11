import { Op } from 'sequelize';
import { HardwareCommand, HardwareDeviceState } from '../database/models/HardwareControl';
import { FeedingCommand } from '../database/models/FeedingCommand';
import { feedingService } from './feedingService';
import { COMMAND_TTL_MS, DEVICE_ONLINE_MS, FEEDING_COMMAND_TTL_MS, type HardwareAction, type HardwareState, type CommandReceipt, type SignedHardwareAck } from './hardwareProtocol';
import { withHardwareDeviceLock, DeviceStopPendingError } from './hardwareControlLock';
import { noteCalibrationResult } from './deviceCalibration';
import { loadThresholdBands } from './thresholdBands';
import type { Transaction } from 'sequelize';

const WATER_START_ACTIONS: HardwareAction[] = ['FILL', 'DRAIN', 'WATER_EXCHANGE', 'FILL_TO_TARGET', 'AUTOMATION_ON'];
const ALL_START_ACTIONS: HardwareAction[] = [...WATER_START_ACTIONS, 'AERATOR_ON', 'AERATOR_AUTO', 'BUZZER_ON'];

const acknowledgeInTransaction = async (userId: string, deviceId: string, receipt: CommandReceipt,
  transaction: Transaction): Promise<boolean> => {
  if (receipt.source === 'feeding') {
    const command = await FeedingCommand.findOne({ where: { id: receipt.id, userId, deviceId }, transaction });
    if (!command) return false;
    if (command.status === 'ACKED') return true;
    command.status = 'ACKED';
    command.executedAt = new Date();
    command.metadata = { ...(command.metadata || {}), deviceResult: receipt.result };
    await command.save({ transaction });
    return true;
  }
  const command = await HardwareCommand.findOne({ where: { id: receipt.id, userId, deviceId }, transaction });
  if (!command) return false;
  if (command.status !== 'PENDING') return true;
  await command.update({ status: 'ACKED', result: receipt.result }, { transaction });
  return true;
};

export const hardwareService = {
  async queue(userId: string, deviceId: string, action: HardwareAction, durationMs?: number, param?: string) {
    const stopping = action === 'ALL_OFF' || action === 'WATER_STOP';
    return withHardwareDeviceLock(userId, deviceId, async (transaction) => {
      if (!stopping && ALL_START_ACTIONS.includes(action)) {
        const blockingStops: HardwareAction[] = WATER_START_ACTIONS.includes(action) ? ['WATER_STOP', 'ALL_OFF'] : ['ALL_OFF'];
        const pendingStop = await HardwareCommand.findOne({
          where: { userId, deviceId, status: 'PENDING', action: { [Op.in]: blockingStops } }, transaction,
        });
        if (pendingStop) throw new DeviceStopPendingError();
      }
      if (!stopping && await HardwareCommand.count({ where: {
        userId, deviceId, status: 'PENDING', expiresAt: { [Op.gt]: new Date() },
      }, transaction }) >= 20) throw new Error('Device command queue is full');

      // Cancellation, stop persistence, and polling all share this transaction lock.
      if (stopping) {
        const cancelledActions = action === 'WATER_STOP' ? WATER_START_ACTIONS : undefined;
        await HardwareCommand.update({ status: 'EXPIRED', result: 'cancelled_by_stop' }, {
          where: { userId, deviceId, status: 'PENDING', ...(cancelledActions ? { action: { [Op.in]: cancelledActions } } : {}) }, transaction,
        });
        if (action === 'ALL_OFF') {
          await FeedingCommand.update({ status: 'ACKED', metadata: { deviceResult: 'cancelled_by_stop' } }, {
            where: { userId, deviceId, status: 'PENDING' }, transaction,
          });
        }
      }
      return HardwareCommand.create({ userId, deviceId, action, durationMs: durationMs ?? null, param: param ?? null,
        expiresAt: new Date(Date.now() + COMMAND_TTL_MS) }, { transaction });
    });
  },

  async acknowledge(userId: string, deviceId: string, receipt: CommandReceipt): Promise<boolean> {
    return withHardwareDeviceLock(userId, deviceId, transaction => acknowledgeInTransaction(userId, deviceId, receipt, transaction));
  },

  async sync(userId: string, deviceId: string, state: HardwareState, receipt?: CommandReceipt) {
    // The firmware consumes schedules and heartbeat state over HTTPS. Actuator
    // commands and their acknowledgments use the signed MQTT path.
    void receipt;
    await HardwareDeviceState.upsert({ deviceId, state, receivedAt: new Date() });
    const [schedules, thresholdBands] = await Promise.all([feedingService.listSchedules(userId), loadThresholdBands()]);
    // thresholdBands drive the device buzzer (Alert: 3 beeps, Warning: 2), matching the dashboard marks.
    return { command: null, schedules: schedules.filter(s => s.enabled).slice(0, 20).map(s => ({ id: s.id, date: s.date, time: s.time })),
      timezone: 'Asia/Manila', serverTimeIso: new Date().toISOString(), thresholdBands };
  },

  async expirePendingCommands(): Promise<void> {
    const now = new Date();
    await HardwareCommand.update({ status: 'EXPIRED', result: 'expired_before_delivery' },
      { where: { status: 'PENDING', expiresAt: { [Op.lte]: now } } });
    await FeedingCommand.update({ status: 'ACKED', metadata: { deviceResult: 'expired_before_delivery' } },
      { where: { status: 'PENDING', source: 'MANUAL', createdAt: { [Op.lt]: new Date(now.getTime() - FEEDING_COMMAND_TTL_MS) } } });
  },

  /** Cancels pending manual feeder commands for a device that has stopped reporting. */
  async cancelFeedingForOfflineDevice(deviceId: string): Promise<number> {
    const [count] = await FeedingCommand.update({ status: 'ACKED', metadata: { deviceResult: 'cancelled_device_offline' } },
      { where: { deviceId, status: 'PENDING', source: 'MANUAL' } });
    return count;
  },

  /** True when the device sent a heartbeat or signed ack within DEVICE_ONLINE_MS. */
  async isDeviceReporting(deviceId: string): Promise<boolean> {
    const reported = await HardwareDeviceState.findByPk(deviceId);
    return !!reported && Date.now() - reported.receivedAt.getTime() <= DEVICE_ONLINE_MS;
  },

  async acceptMqttAck(userId: string, ack: SignedHardwareAck): Promise<boolean> {
    const { reportedAt, id, source, action, result, deviceId, state } = ack;
    if (source === 'hardware') {
      const command = await HardwareCommand.findOne({ where: { id, userId, deviceId } });
      if (!command || command.action !== action) return false;
      const appliedResult = command.status === 'PENDING' ? result : (command.result ?? result);
      if (command.status === 'PENDING') await command.update({ status: 'ACKED', result });
      noteCalibrationResult(deviceId, action, command.param, appliedResult);
    } else {
      const command = await FeedingCommand.findOne({ where: { id, userId, deviceId } });
      if (!command || command.action !== action || command.source !== 'MANUAL') return false;
      if (command.status === 'PENDING') await feedingService.ackCommand(userId, deviceId, id,
        { deviceResult: result, reportedAt: new Date(reportedAt).toISOString() });
    }
    // Online means the server just heard the device. The device clock stays in the signed ack.
    await HardwareDeviceState.upsert({ deviceId, state, receivedAt: new Date() });
    return true;
  },

  async getState(userId: string, deviceId: string) {
    const [reported, commands] = await Promise.all([
      HardwareDeviceState.findByPk(deviceId),
      HardwareCommand.findAll({ where: { userId, deviceId }, order: [['createdAt', 'DESC']], limit: 20 }),
    ]);
    return { deviceId, online: !!reported && Date.now() - reported.receivedAt.getTime() <= DEVICE_ONLINE_MS,
      receivedAt: reported?.receivedAt ?? null, state: reported?.state ?? null, commands };
  },
};
