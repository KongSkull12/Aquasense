import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';
import type { UserRole } from '../../services/userRoles';

/**
 * User model for AquaSense database
 */
export class User extends Model {
  declare id: string;
  declare fullName: string;
  declare email: string;
  declare role: UserRole;
  declare employerUserId: string | null;
  declare passwordHash: string;
  declare createdAt: Date;
  declare updatedAt: Date;
}

/**
 * Initialize User model
 */
export const initializeUserModel = (): void => {
  const sequelize = getDatabase();

  User.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      fullName: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
          isEmail: true,
        },
      },
      role: {
        type: DataTypes.ENUM('admin', 'farmer', 'staff', 'guest'),
        allowNull: false,
        defaultValue: 'farmer',
      },
      employerUserId: {
        type: DataTypes.UUID,
        allowNull: true,
        field: 'employer_user_id',
      },
      passwordHash: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'User',
      tableName: 'users',
      timestamps: true,
    }
  );
};
