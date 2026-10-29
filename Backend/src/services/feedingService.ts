import { Op } from 'sequelize';
import { FeedingSchedule } from '../database/models/FeedingSchedule';
import { FeedingCommand, FeedingCommandAction } from '../database/models/FeedingCommand';
import { HardwareCommand } from '../database/models/HardwareControl';
import { DeviceStopPendingError, withHardwareDeviceLock } from './hardwareControlLock';

interface CreateScheduleInput {
  userId: string;
  date?: string | null;
  time: string;
  enabled?: boolean;
  label?: string;
}

interface UpdateScheduleInput {
  userId: string;
  date?: string | null;
  time?: string;
  enabled?: boolean;
  label?: string | null;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const assertValidTime = (time: string): void => {
  if (!TIME_RE.test(time)) {
    throw new Error('Invalid time format. Use HH:mm (24-hour).');
  }
};

const assertValidDate = (date: string): void => {
  if (!DATE_RE.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
    throw new Error('Invalid date format. Use YYYY-MM-DD.');
  }
};

export const feedingService = {
  async listSchedules(userId: string): Promise<FeedingSchedule[]> {
    return FeedingSchedule.findAll({ where: { userId }, order: [['time', 'ASC']] });
  },

  async createSchedule(input: CreateScheduleInput): Promise<FeedingSchedule> {
    assertValidTime(input.time);
    if (input.date) {
      assertValidDate(input.date);
    }
    return FeedingSchedule.create({
      userId: input.userId,
      date: input.date || null,
      time: input.time,
      enabled: input.enabled ?? true,
      label: input.label?.trim() || null,
    });
  },

  async updateSchedule(id: string, input: UpdateScheduleInput): Promise<FeedingSchedule | null> {
    const schedule = await FeedingSchedule.findOne({ where: { id, userId: input.userId } });
    if (!schedule) return null;

    if (input.time !== undefined) {
      assertValidTime(input.time);
      schedule.time = input.time;
    }
    if (input.date !== undefined) {
      if (input.date) {
        assertValidDate(input.date);
        schedule.date = input.date;
      } else {
        schedule.date = null;
      }
    }
    if (input.enabled !== undefined) {
      schedule.enabled = input.enabled;
    }
    if (input.label !== undefined) {
      schedule.label = input.label ? input.label.trim() : null;
    }

    await schedule.save();
    return schedule;
  },

  async deleteSchedule(id: string, userId: string): Promise<boolean> {
    const deleted = await FeedingSchedule.destroy({ where: { id, userId } });
    return deleted > 0;
  },

  async queueManualCommand(
    userId: string,
    deviceId: string,
    action: FeedingCommandAction,
    metadata?: Record<string, unknown>
  ): Promise<FeedingCommand> {
    return withHardwareDeviceLock(userId, deviceId, async (transaction) => {
      if (action !== 'OFF') {
        const pendingStop = await HardwareCommand.findOne({
          where: { userId, deviceId, action: 'ALL_OFF', status: 'PENDING' }, transaction,
        });
        if (pendingStop) throw new DeviceStopPendingError();
      }
      return FeedingCommand.create({
        userId,
        deviceId,
        action,
        source: 'MANUAL',
        status: 'PENDING',
        metadata: metadata || null,
      }, { transaction });
    });
  },

  async discardUnpublishedManualCommand(userId: string, deviceId: string, commandId: string): Promise<void> {
    await FeedingCommand.destroy({
      where: { id: commandId, userId, deviceId, source: 'MANUAL', status: 'PENDING' },
    });
  },

  async getLatestDeviceCommand(userId: string, deviceId: string): Promise<FeedingCommand | null> {
    return FeedingCommand.findOne({
      where: {
        userId,
        deviceId,
        status: 'PENDING',
      },
      order: [['createdAt', 'ASC']],
    });
  },

  async ackCommand(userId: string, deviceId: string, commandId: string, metadata?: Record<string, unknown>): Promise<boolean> {
    const command = await FeedingCommand.findOne({
      where: {
        userId,
        id: commandId,
        deviceId,
        status: 'PENDING',
      },
    });
    if (!command) return false;

    command.status = 'ACKED';
    command.executedAt = new Date();
    if (metadata) {
      command.metadata = { ...(command.metadata || {}), ...metadata };
    }
    await command.save();
    return true;
  },

  async markScheduleTriggered(userId: string, time: string): Promise<void> {
    await FeedingSchedule.update(
      { lastTriggeredAt: new Date() },
      {
        where: {
          userId,
          time,
          enabled: true,
        },
      }
    );
  },

  async getState(userId: string, deviceId: string): Promise<{
    scheduleCount: number;
    enabledCount: number;
    pendingCommands: number;
    lastCommand: FeedingCommand | null;
  }> {
    const [scheduleCount, enabledCount, pendingCommands, lastCommand] = await Promise.all([
      FeedingSchedule.count({ where: { userId } }),
      FeedingSchedule.count({ where: { userId, enabled: true } }),
      FeedingCommand.count({ where: { userId, deviceId, status: 'PENDING' } }),
      FeedingCommand.findOne({
        where: { userId, deviceId, status: { [Op.in]: ['PENDING', 'ACKED'] } },
        order: [['createdAt', 'DESC']],
      }),
    ]);

    return { scheduleCount, enabledCount, pendingCommands, lastCommand };
  },
};
