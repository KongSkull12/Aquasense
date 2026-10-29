/**
 * User Service - Handles user management and authentication
 * Using PostgreSQL database with Sequelize ORM
 */
import bcryptjs from 'bcryptjs';
import { logger } from '../utils/logger';
import { User as UserModel } from '../database/models/User';

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: 'admin' | 'farmer' | 'guest';
  passwordHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

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

      // Validate password strength
      if (
        password.length < 12 ||
        !/[A-Z]/.test(password) ||
        !/[a-z]/.test(password) ||
        !/\d/.test(password) ||
        !/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)
      ) {
        throw new Error('Password must be at least 12 characters and include uppercase, lowercase, number, and special character');
      }

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
      passwordHash: user.passwordHash,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export const userService = new UserService();
