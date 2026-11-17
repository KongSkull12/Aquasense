import { Op } from 'sequelize';
import { FeedingSchedule } from '../database/models/FeedingSchedule';
import { FeedingCommand, FeedingCommandAction } from '../database/models/FeedingCommand';
import { HardwareCommand } from '../database/models/HardwareControl';
import { DeviceStopPendingError, withHardwareDeviceLock } from './hardwareControlLock';
import { config } from '../config/config';
import { logger } from '../utils/logger';

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
const FEEDING_TZ = config.feeding.timezone || 'Asia/Manila';

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

/** Calendar date in the farm feeding timezone (YYYY-MM-DD). */
export const feedingCalendarDate = (now = new Date(), timeZone = FEEDING_TZ): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/**
 * One-time dates that already passed never match the ESP32 clock, so the feeder
 * never runs. Treat them as daily (null) — the usual farmer intent for "schedule".
 */
export const effectiveScheduleDate = (date: string | null | undefined, now = new Date()): string | null => {
  if (!date) return null;
  assertValidDate(date);
  const today = feedingCalendarDate(now);
  // Past calendar dates (including wrong years like 2024-…) become daily.
  if (date < today) return null;
  return date;
};

export const feedingService = {
  /** Clear expired one-shot dates so schedules keep firing every day. */
  async healPastDatedSchedules(userId?: string): Promise<number> {
    const today = feedingCalendarDate();
    const where: Record<string, unknown> = {
      date: { [Op.and]: [{ [Op.ne]: null }, { [Op.lt]: today }] },
    };
    if (userId) where.userId = userId;
    const [count] = await FeedingSchedule.update({ date: null }, { where });
    if (count > 0) {
      logger.info('Converted past one-time feeding dates to daily', { userId: userId || 'all', count, today });
    }
    return count;
  },

  async listSchedules(userId: string): Promise<FeedingSchedule[]> {
    await this.healPastDatedSchedules(userId);
    const rows = await FeedingSchedule.findAll({ where: { userId }, order: [['time', 'ASC']] });
    // Belt-and-suspenders: if a past date slipped past the bulk UPDATE, clear it here too.
    const today = feedingCalendarDate();
    for (const row of rows) {
      if (row.date && row.date < today) {
        row.date = null;
        await row.save();
      }
    }
    return rows;
  },

  async createSchedule(input: CreateScheduleInput): Promise<FeedingSchedule> {
    assertValidTime(input.time);
    const date = input.date ? effectiveScheduleDate(input.date) : null;
    return FeedingSchedule.create({
      userId: input.userId,
      date,
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
      schedule.date = input.date ? effectiveScheduleDate(input.date) : null;
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
