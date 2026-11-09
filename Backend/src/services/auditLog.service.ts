import { AuditLog } from '../database/models/AuditLog';
import { logger } from '../utils/logger';

interface CreateAuditLogInput {
  userId?: string | null;
  deviceId?: string | null;
  action: string;
  status: 'SUCCESS' | 'FAILURE';
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}

class AuditLogService {
  async createLog(input: CreateAuditLogInput): Promise<void> {
    try {
      await AuditLog.create({
        userId: input.userId || null,
        deviceId: input.deviceId || null,
        action: input.action,
        status: input.status,
        ipAddress: input.ipAddress || null,
        metadata: input.metadata || null,
      });
    } catch (error) {
      logger.warn('Failed to write audit log', error);
    }
  }
}

export const auditLogService = new AuditLogService();
