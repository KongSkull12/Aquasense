import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class Alert extends Model {
  declare id: string;
  declare deviceId: string;
  declare category: string;
  declare severity: string;
  declare currentValue: number;
  declare thresholdValue: number;
  declare unit: string;
  declare action: string;
  declare message: string;
  declare status: string;
  declare smsSentAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeAlertModel = (): void => {
  const sequelize = getDatabase();

  Alert.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
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
      currentValue: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      thresholdValue: {
        type: DataTypes.FLOAT,
        allowNull: false,
      },
      unit: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      action: {
        type: DataTypes.STRING(64),
        allowNull: false,
      },
      message: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      status: {
        type: DataTypes.STRING(16),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      smsSentAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'Alert',
      tableName: 'alerts',
      timestamps: true,
      indexes: [
        {
          fields: ['device_id', 'category', 'created_at'],
        },
        {
          fields: ['status'],
        },
      ],
    }
  );
};
