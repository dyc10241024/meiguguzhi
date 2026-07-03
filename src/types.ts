export type ValuationMode = 'full-holdings' | 'sector-compensated' | 'normalized-top10';

export interface Calibration {
  alpha: number;
  beta: number;
}

export interface BacktestRow {
  navDate: string;
  actualPct: number;
  rawEstimatePct: number;
  tunedEstimatePct: number;
  rawErrorPct: number;
  tunedErrorPct: number;
}

export interface BacktestFund {
  code: string;
  name: string;
  calibration: Calibration;
  notes: string[];
  rows: BacktestRow[];
}

export interface BacktestFixture {
  schemaVersion: number;
  name: string;
  description: string;
  generatedAt: string;
  dataWindow: {
    startNavDate: string;
    endNavDate: string;
    navDays: number;
  };
  algorithm: unknown;
  metrics: Record<string, unknown>;
  funds: BacktestFund[];
}

export interface Metrics {
  sampleCount: number;
  mae: number;
  rmse: number;
  bias: number;
  directionCorrect: number;
}

export interface HoldingInput {
  weight: number;
  returnPct: number;
}

export interface SectorExposureInput {
  exposure: number;
  returnPct: number;
}

export interface FullHoldingsInput {
  holdings: HoldingInput[];
  equityWeight: number;
  proxyReturnPct: number;
  fxContributionPct: number;
  calibration: Calibration;
}

export interface SectorCompensatedInput {
  knownHoldings: HoldingInput[];
  equityWeight: number;
  sectorExposures: SectorExposureInput[];
  fxContributionPct: number;
  calibration: Calibration;
}

export interface NormalizedTop10Input {
  holdings: HoldingInput[];
  equityWeight: number;
  fxContributionPct: number;
  calibration: Calibration;
}

export interface EstimateResult {
  mode: ValuationMode;
  rawPct: number;
  finalPct: number;
  knownContributionPct: number;
  unknownContributionPct: number;
  knownWeight: number;
  unknownWeight: number;
  normalizedHoldingReturnPct?: number;
  equityWeight?: number;
  fxContributionPct?: number;
}
