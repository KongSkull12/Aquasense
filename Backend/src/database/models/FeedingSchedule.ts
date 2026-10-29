import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class FeedingSchedule extends Model {
  declare id: string;
  declare userId: string;
  declare date: string | null; // YYYY-MM-DD (optional)
  declare time: string; // HH:mm
  declare enabled: boolean;
  declare label: string | null;
  declare lastTriggeredAt: Date | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeFeedingScheduleModel = (): void => {
  const sequelize = getDatabase();

  FeedingSchedule.init(
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
      time: {
        type: DataTypes.STRING(5),
        allowNull: false,
        validate: {
          is: /^([01]\d|2[0-3]):([0-5]\d)$/,
        },
      },
      date: {
        type: DataTypes.STRING(10),
        allowNull: true,
        validate: {
          is: /^\d{4}-\d{2}-\d{2}$/,
        },
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      label: {
        type: DataTypes.STRING(120),
        allowNull: true,
      },
      lastTriggeredAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'FeedingSchedule',
      tableName: 'feeding_schedules',
      timestamps: true,
      indexes: [
        { fields: ['user_id'] },
        { fields: ['date'] },
        { fields: ['time'] },
        { fields: ['enabled'] },
      ],
    }
  );
};
