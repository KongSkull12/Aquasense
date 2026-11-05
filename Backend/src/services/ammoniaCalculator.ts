/**
 * Freshwater ammonia speciation (Emerson et al., 1975).
 *
 * Temperature and pH give only the un-ionised share of total ammonia (the NH3 fraction).
 * An ammonia concentration needs one independent measurement: either TAN (Option A) or
 * NH3-N (Option B). Concentrations are in mg/L as N.
 */

export const AMMONIA_TEMPERATURE_RANGE_C = { min: 0, max: 50 } as const;
export const AMMONIA_PH_RANGE = { min: 0, max: 14 } as const;
export const AMMONIA_MAX_CONCENTRATION = 1000;

export type AmmoniaMeasurement = { kind: 'TAN' | 'NH3_N'; value: number };

export interface AmmoniaCalculationInput {
  temperatureC: number;
  ph: number;
  measurement?: AmmoniaMeasurement | null;
}

export interface AmmoniaCalculation {
  temperatureC: number;
  ph: number;
  pKa: number;
  nh3Fraction: number;
  nh3Percent: number;
  tan: number | null;
  nh3N: number | null;
  tanOrigin: 'measured' | 'calculated' | null;
  nh3NOrigin: 'measured' | 'calculated' | null;
  concentrationUnit: 'mg/L as N';
}

export class AmmoniaInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AmmoniaInputError';
  }
}

/** Step 2: pKa = 0.09018 + 2729.92 / (T + 273.15), T in °C. */
export const ammoniaPKa = (temperatureC: number): number => 0.09018 + 2729.92 / (temperatureC + 273.15);

/** Step 3: fNH3 = 1 / (1 + 10^(pKa − pH)). */
export const nh3Fraction = (pKa: number, ph: number): number => 1 / (1 + 10 ** (pKa - ph));

/** Steps 2–6 for one temperature, pH and optional ammonia measurement. */
export const calculateAmmonia = ({ temperatureC, ph, measurement }: AmmoniaCalculationInput): AmmoniaCalculation => {
  if (!Number.isFinite(temperatureC) || temperatureC < AMMONIA_TEMPERATURE_RANGE_C.min || temperatureC > AMMONIA_TEMPERATURE_RANGE_C.max) {
    throw new AmmoniaInputError(`Temperature must be between ${AMMONIA_TEMPERATURE_RANGE_C.min} and ${AMMONIA_TEMPERATURE_RANGE_C.max} °C for the freshwater equation`);
  }
  if (!Number.isFinite(ph) || ph < AMMONIA_PH_RANGE.min || ph > AMMONIA_PH_RANGE.max) {
    throw new AmmoniaInputError(`pH must be between ${AMMONIA_PH_RANGE.min} and ${AMMONIA_PH_RANGE.max}`);
  }
  if (measurement && (!Number.isFinite(measurement.value) || measurement.value < 0 || measurement.value > AMMONIA_MAX_CONCENTRATION)) {
    throw new AmmoniaInputError(`Measured ${measurement.kind === 'TAN' ? 'TAN' : 'NH3-N'} must be between 0 and ${AMMONIA_MAX_CONCENTRATION} mg/L as N`);
  }

  const pKa = ammoniaPKa(temperatureC);
  const fraction = nh3Fraction(pKa, ph);
  const result: AmmoniaCalculation = {
    temperatureC,
    ph,
    pKa,
    nh3Fraction: fraction,
    nh3Percent: fraction * 100,
    tan: null,
    nh3N: null,
    tanOrigin: null,
    nh3NOrigin: null,
    concentrationUnit: 'mg/L as N',
  };

  if (measurement?.kind === 'TAN') {
    // Option A: NH3-N = TAN × fNH3
    result.tan = measurement.value;
    result.tanOrigin = 'measured';
    result.nh3N = measurement.value * fraction;
    result.nh3NOrigin = 'calculated';
  } else if (measurement?.kind === 'NH3_N') {
    // Option B: TAN = NH3-N / fNH3 (fNH3 is always > 0, so the division is defined)
    result.nh3N = measurement.value;
    result.nh3NOrigin = 'measured';
    result.tan = measurement.value / fraction;
    result.tanOrigin = 'calculated';
  }
  return result;
};
