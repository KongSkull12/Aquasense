import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class SmsLog extends Model {
  declare id: string;
  declare alertId: string | null;
  declare deviceId: string;
  declare category: string;
  declare severity: string;
  declare recipient: string;
  declare provider: string;
  declare providerResponse: string;
  declare success: boolean;
  declare retryCount: number;
  declare sentAt: Date;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeSmsLogModel = (): void => {
  const sequelize = getDatabase();

  SmsLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      alertId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      deviceId: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      category: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      severity: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      recipient: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      provider: {
        type: DataTypes.STRING(32),
        allowNull: false,
      },
      providerResponse: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      success: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      retryCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      sentAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'SmsLog',
      tableName: 'sms_logs',
      timestamps: true,
      indexes: [
        {
          fields: ['device_id', 'category', 'sent_at'],
        },
        {
          fields: ['alert_id'],
        },
      ],
    }
  );
};
