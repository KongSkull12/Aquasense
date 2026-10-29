import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';
import type { HardwareAction, HardwareState } from '../../services/hardwareProtocol';

export class HardwareCommand extends Model {
  declare id: string;
  declare userId: string;
  declare deviceId: string;
  declare action: HardwareAction;
  declare durationMs: number | null;
  declare status: 'PENDING' | 'ACKED' | 'EXPIRED';
  declare result: string | null;
  declare expiresAt: Date;
  declare createdAt: Date;
}
export class HardwareDeviceState extends Model {
  declare deviceId: string;
  declare state: HardwareState;
  declare receivedAt: Date;
}
export function initializeHardwareControlModels(): void {
  const sequelize = getDatabase();
  HardwareCommand.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    userId: { type: DataTypes.UUID, allowNull: false },
    deviceId: { type: DataTypes.STRING(120), allowNull: false },
    action: { type: DataTypes.STRING(32), allowNull: false },
    durationMs: { type: DataTypes.INTEGER, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'PENDING' },
    result: { type: DataTypes.STRING(64), allowNull: true },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, tableName: 'hardware_commands', modelName: 'HardwareCommand', timestamps: true,
    indexes: [{ fields: ['user_id', 'device_id', 'status'] }] });
  HardwareDeviceState.init({
    deviceId: { type: DataTypes.STRING(120), primaryKey: true },
    state: { type: DataTypes.JSONB, allowNull: false },
    receivedAt: { type: DataTypes.DATE, allowNull: false },
  }, { sequelize, tableName: 'hardware_device_states', modelName: 'HardwareDeviceState', timestamps: false });
}
