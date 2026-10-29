export type PredictiveRiskLevel = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';

export interface PredictiveAnalyticsResult {
  generatedAt: string;
  modelVersion: string;
  horizonMinutes: number;
  modelStatus: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  validationStatus: 'VALIDATED' | 'NOT_COMMISSIONED';
  analysisStatus: 'AVAILABLE' | 'INSUFFICIENT_VALID_SENSOR_DATA';
  calibration: 'REQUIRED';
  riskScore: number | null;
  riskLevel: PredictiveRiskLevel;
  predictedIssue: string;
  warningCard: {
    riskLevel: PredictiveRiskLevel;
    predictedIssue: string;
    cause: string;
    action: string;
    confidence: number;
    estimatedUnsafeInMinutes: number | null;
  };
  movingAverage: null;
  latest: null;
  dataQuality: {
    score: 0;
    sampleCount: 0;
    windowMinutes: number;
    newestSampleAgeMinutes: null;
    measuredAmmoniaRatio: 0;
    notes: string[];
  };
  trends: null;
}

/**
 * The prior rules-v3 model requires a physical DO reading that AquaSense
 * hardware does not provide. ORP is not a quantitative DO substitute, and no
 * validated replacement model is commissioned. Keep the compatibility
 * response shape, but never emit a score, forecast, or DO-based recommendation.
 */
class PredictiveAnalyticsService {
  async getWarningCard(minutes: number = 60): Promise<PredictiveAnalyticsResult> {
    const horizonMinutes=Math.max(15,Math.min(1440,Math.round(Number.isFinite(minutes)?minutes:60)));
    const cause='Risk analysis is unavailable because AquaSense has no physical dissolved-oxygen sensor and no validated replacement risk model';
    return {
      generatedAt:new Date().toISOString(),
      modelVersion:'unavailable-no-validated-model',
      modelStatus:'UNAVAILABLE',
      validationStatus:'NOT_COMMISSIONED',
      horizonMinutes,
      analysisStatus:'INSUFFICIENT_VALID_SENSOR_DATA',
      calibration:'REQUIRED',
      riskScore:null,
      riskLevel:'UNAVAILABLE',
      predictedIssue:'RISK ANALYSIS UNAVAILABLE',
      warningCard:{riskLevel:'UNAVAILABLE',predictedIssue:'RISK ANALYSIS UNAVAILABLE',cause,action:'No automated recommendation is available; review validated sensor readings',confidence:0,estimatedUnsafeInMinutes:null},
      movingAverage:null,
      latest:null,
      dataQuality:{score:0,sampleCount:0,windowMinutes:0,newestSampleAgeMinutes:null,measuredAmmoniaRatio:0,notes:['No commissioned risk model; ORP is not converted to dissolved oxygen']},
      trends:null,
    };
  }

  async persistCurrentPrediction(minutes: number = 60, _triggeredAlertId?: string): Promise<PredictiveAnalyticsResult> {
    return this.getWarningCard(minutes);
  }
}

export const predictiveAnalyticsService = new PredictiveAnalyticsService();
