import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';
import type { WaterQualityThresholds } from '../../iot/water/types';

export class WaterQualitySetting extends Model {
  declare id: string;
  declare thresholds: WaterQualityThresholds;
}

export const initializeWaterQualitySettingModel = (): void => {
  WaterQualitySetting.init({
    id: { type: DataTypes.STRING(32), primaryKey: true },
    thresholds: { type: DataTypes.JSONB, allowNull: false },
  }, { sequelize: getDatabase(), tableName: 'water_quality_settings', modelName: 'WaterQualitySetting', timestamps: true });
};
