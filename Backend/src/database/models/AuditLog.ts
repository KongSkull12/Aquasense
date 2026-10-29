import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class AuditLog extends Model {
  declare id: string;
  declare userId: string | null;
  declare deviceId: string | null;
  declare action: string;
  declare status: 'SUCCESS' | 'FAILURE';
  declare ipAddress: string | null;
  declare metadata: Record<string, unknown> | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeAuditLogModel = (): void => {
  const sequelize = getDatabase();

  AuditLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      deviceId: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('SUCCESS', 'FAILURE'),
        allowNull: false,
      },
      ipAddress: {
        type: DataTypes.STRING(80),
        allowNull: true,
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'AuditLog',
      tableName: 'audit_logs',
      timestamps: true,
      indexes: [{ fields: ['user_id'] }, { fields: ['device_id'] }, { fields: ['action'] }, { fields: ['created_at'] }],
    }
  );
};
