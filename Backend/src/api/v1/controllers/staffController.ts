import { Response } from 'express';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { userService } from '../../../services/userService';
import { sendError, sendSuccess } from '../../../utils/response';
import { logger } from '../../../utils/logger';
import { auditLogService } from '../../../services/auditLog.service';

export const listStaffAccounts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId || req.userRole !== 'admin') {
      sendError(res, 403, 'Only an admin can manage staff accounts');
      return;
    }
    const staff = await userService.listStaffForEmployer(req.userId);
    sendSuccess(res, 200, 'Staff accounts', staff.map((user) => userService.getPublicUser(user)));
  } catch (error) {
    logger.error('Failed to list staff accounts', error);
    sendError(res, 500, 'Failed to list staff accounts');
  }
};

export const createStaffAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId || req.userRole !== 'admin') {
      sendError(res, 403, 'Only an admin can create staff accounts');
      return;
    }
    const { fullName, email, password } = req.body as { fullName: string; email: string; password: string };
    const staff = await userService.createStaffAccount(req.userId, fullName, email, password);
    await auditLogService.createLog({
      userId: req.userId,
      action: 'STAFF_CREATE',
      status: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { staffUserId: staff.id, email: staff.email },
    });
    sendSuccess(res, 201, 'Staff account created', userService.getPublicUser(staff));
  } catch (error) {
    logger.error('Failed to create staff account', error);
    sendError(res, 400, error instanceof Error ? error.message : 'Failed to create staff account');
  }
};

export const removeStaffAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId || req.userRole !== 'admin') {
      sendError(res, 403, 'Only an admin can remove staff accounts');
      return;
    }
    const staffUserId = req.params.id;
    const removed = await userService.removeStaffAccount(req.userId, staffUserId);
    if (!removed) {
      sendError(res, 404, 'Staff account not found');
      return;
    }
    await auditLogService.createLog({
      userId: req.userId,
      action: 'STAFF_REMOVE',
      status: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { staffUserId },
    });
    sendSuccess(res, 200, 'Staff account removed');
  } catch (error) {
    logger.error('Failed to remove staff account', error);
    sendError(res, 500, 'Failed to remove staff account');
  }
};
