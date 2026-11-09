import { DataTypes, Model } from 'sequelize';
import { getDatabase } from '../connection';

export class PredictionLog extends Model {
  declare id: string;
  declare riskScore: number;
  declare riskLevel: string;
  declare predictedIssue: string;
  declare etaMinutes: number | null;
  declare triggeredAlertId: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export const initializePredictionLogModel = (): void => {
  const sequelize = getDatabase();

  PredictionLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      riskScore: {
        type: DataTypes.FLOAT,
        allowNull: false,
        validate: {
          min: 0,
          max: 100,
        },
      },
      riskLevel: {
        type: DataTypes.STRING(16),
        allowNull: false,
      },
      predictedIssue: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      etaMinutes: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      triggeredAlertId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: 'PredictionLog',
      tableName: 'prediction_logs',
      timestamps: true,
      indexes: [
        {
          fields: ['created_at'],
        },
        {
          fields: ['risk_level'],
        },
        {
          fields: ['triggered_alert_id'],
        },
      ],
    }
  );
};
