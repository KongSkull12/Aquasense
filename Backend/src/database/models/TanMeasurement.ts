import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export type TanSource = 'test_kit' | 'laboratory' | 'external_sensor' | 'manual';

export class TanMeasurement extends Model {
  declare id: string;
  declare deviceId: string;
  declare enteredByUserId: string;
  declare value: number;
  declare unit: 'mg/L as N';
  declare source: TanSource;
  declare sampleCollectedAt: Date;
  declare enteredAt: Date;
  declare validationEvidence: string;
  declare validationStatus: 'USER_ATTESTED';
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeTanMeasurementModel = (): void => {
  TanMeasurement.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    deviceId: { type: DataTypes.STRING(120), allowNull: false, field: 'device_id' },
    enteredByUserId: { type: DataTypes.UUID, allowNull: false, field: 'entered_by_user_id' },
    value: { type: DataTypes.DOUBLE, allowNull: false, validate: { min: 0 } },
    unit: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'mg/L as N' },
    source: { type: DataTypes.STRING(24), allowNull: false },
    sampleCollectedAt: { type: DataTypes.DATE, allowNull: false, field: 'sample_collected_at' },
    enteredAt: { type: DataTypes.DATE, allowNull: false, field: 'entered_at' },
    validationEvidence: { type: DataTypes.TEXT, allowNull: false, field: 'validation_evidence' },
    validationStatus: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'USER_ATTESTED', field: 'validation_status' },
  }, {
    sequelize: getDatabase(),
    modelName: 'TanMeasurement',
    tableName: 'tan_measurements',
    timestamps: true,
    indexes: [
      { fields: ['device_id', 'sample_collected_at'] },
      { fields: ['entered_by_user_id', 'entered_at'] },
    ],
  });
};
