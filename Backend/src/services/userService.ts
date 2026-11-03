/**
 * User Service - Handles user management and authentication
 * Using PostgreSQL database with Sequelize ORM
 */
import bcryptjs from 'bcryptjs';
import { logger } from '../utils/logger';
import { User as UserModel } from '../database/models/User';
import type { UserRole } from './userRoles';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  employerUserId?: string | null;
  passwordHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const validatePasswordStrength = (password: string): void => {
  if (
    password.length < 12 ||
    !/[A-Z]/.test(password) ||
    !/[a-z]/.test(password) ||
    !/\d/.test(password) ||
    !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
  ) {
    throw new Error('Password must be at least 12 characters and include uppercase, lowercase, number, and special character');
  }
};

class UserService {
  /**
   * Register a new user
   */
  async registerUser(fullName: string, email: string, password: string): Promise<User | null> {
    try {
      // Validate email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        throw new Error('Invalid email format');
      }

      validatePasswordStrength(password);

      // Check if user already exists
      const existingUser = await UserModel.findOne({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        throw new Error('User with this email already exists');
      }

      // Hash password
      const saltRounds = 10;
      const passwordHash = await bcryptjs.hash(password, saltRounds);

      // Create user in database
      const user = await UserModel.create({
        fullName,
        email: email.toLowerCase(),
        passwordHash,
      });

      logger.info('New user registered', { id: user.id, email: user.email });

      return this.mapUserModel(user);
    } catch (error) {
      logger.error('Error registering user', error);
      throw error;
    }
  }

  /** Admin creates a staff account that shares the admin tank devices. */
  async createStaffAccount(employerUserId: string, fullName: string, email: string, password: string): Promise<User> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) throw new Error('Invalid email format');
    validatePasswordStrength(password);

    const employer = await UserModel.findByPk(employerUserId);
    if (!employer || employer.role !== 'admin') {
      throw new Error('Only an admin can create staff accounts');
    }

    const existingUser = await UserModel.findOne({ where: { email: email.toLowerCase() } });
    if (existingUser) throw new Error('User with this email already exists');

    const passwordHash = await bcryptjs.hash(password, 10);
    const user = await UserModel.create({
      fullName: fullName.trim(),
      email: email.toLowerCase(),
      role: 'staff',
      employerUserId,
      passwordHash,
    });
    logger.info('Staff account created', { id: user.id, email: user.email, employerUserId });
    return this.mapUserModel(user);
  }

  async listStaffForEmployer(employerUserId: string): Promise<User[]> {
    const rows = await UserModel.findAll({
      where: { employerUserId, role: 'staff' },
      order: [['createdAt', 'DESC']],
    });
    return rows.map((row) => this.mapUserModel(row));
  }

  async removeStaffAccount(employerUserId: string, staffUserId: string): Promise<boolean> {
    const staff = await UserModel.findOne({ where: { id: staffUserId, employerUserId, role: 'staff' } });
    if (!staff) return false;
    await staff.destroy();
    logger.info('Staff account removed', { staffUserId, employerUserId });
    return true;
  }

  /**
   * Authenticate user (login)
   */
  async authenticateUser(email: string, password: string): Promise<User | null> {
    try {
      const user = await UserModel.findOne({
        where: { email: email.toLowerCase() },
      });

      if (!user) {
        logger.warn('Login attempt with non-existent email', { email });
        return null;
      }

      // Compare password
      const isPasswordValid = await bcryptjs.compare(password, user.passwordHash);

      if (!isPasswordValid) {
        logger.warn('Login attempt with invalid password', { email });
        return null;
      }

      logger.info('User authenticated', { id: user.id, email: user.email });
      return this.mapUserModel(user);
    } catch (error) {
      logger.error('Error authenticating user', error);
      return null;
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(id: string): Promise<User | null> {
    try {
      const user = await UserModel.findByPk(id);
      return user ? this.mapUserModel(user) : null;
    } catch (error) {
      logger.error('Error fetching user by ID', error);
      return null;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const user = await UserModel.findOne({
        where: { email: email.toLowerCase() },
      });
      return user ? this.mapUserModel(user) : null;
    } catch (error) {
      logger.error('Error fetching user by email', error);
      return null;
    }
  }

  /**
   * Get user without password hash
   */
  getPublicUser(user: User): Omit<User, 'passwordHash'> {
    const publicUser: Partial<User> = { ...user };
    delete publicUser.passwordHash;
    return publicUser as Omit<User, 'passwordHash'>;
  }

  /**
   * Map Sequelize User model to User interface
   */
  private mapUserModel(user: UserModel): User {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      employerUserId: user.employerUserId,
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export const userService = new UserService();
