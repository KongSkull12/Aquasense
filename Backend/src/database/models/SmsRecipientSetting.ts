import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class SmsRecipientSetting extends Model {
  declare userId: string;
  declare enabled: boolean;
  declare phones: string[];
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializeSmsRecipientSettingModel = (): void => {
  SmsRecipientSetting.init({
    userId: { type: DataTypes.UUID, primaryKey: true },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    phones: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
  }, {
    sequelize: getDatabase(),
    modelName: 'SmsRecipientSetting',
    tableName: 'sms_recipient_settings',
    timestamps: true,
    underscored: true,
  });
};
