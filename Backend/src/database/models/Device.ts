import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class Device extends Model {
  declare id: string;
  declare userId: string;
  declare deviceId: string;
  declare name: string;
  declare isActive: boolean;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeDeviceModel = (): void => {
  const sequelize = getDatabase();

  Device.init(
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
        unique: true,
      },
      name: {
        type: DataTypes.STRING(120),
        allowNull: false,
        defaultValue: 'My Device',
      },
      isActive: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
    },
    {
      sequelize,
      modelName: 'Device',
      tableName: 'devices',
      timestamps: true,
      indexes: [{ fields: ['user_id'] }, { fields: ['device_id'] }],
    }
  );
};
