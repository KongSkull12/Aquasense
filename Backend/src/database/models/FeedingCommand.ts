import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export type FeedingCommandAction = 'ON' | 'OFF' | 'TRIGGER';
export type FeedingCommandStatus = 'PENDING' | 'ACKED';
export type FeedingCommandSource = 'MANUAL' | 'SCHEDULE';

export class FeedingCommand extends Model {
  declare id: string;
  declare userId: string;
  declare deviceId: string;
  declare action: FeedingCommandAction;
  declare source: FeedingCommandSource;
  declare status: FeedingCommandStatus;
  declare metadata: Record<string, unknown> | null;
  declare executedAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeFeedingCommandModel = (): void => {
  const sequelize = getDatabase();

  FeedingCommand.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      userId: {
        type: DataTypes.UUID,
        allowNull: false,
      },
      deviceId: {
        type: DataTypes.STRING(120),
        allowNull: false,
      },
      action: {
        type: DataTypes.ENUM('ON', 'OFF', 'TRIGGER'),
        allowNull: false,
      },
      source: {
        type: DataTypes.ENUM('MANUAL', 'SCHEDULE'),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM('PENDING', 'ACKED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      executedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'FeedingCommand',
      tableName: 'feeding_commands',
      timestamps: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['device_id', 'status'] },
        { fields: ['created_at'] },
      ],
    }
  );
};
