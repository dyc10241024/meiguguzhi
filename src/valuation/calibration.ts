import type { BacktestRow, Calibration, Metrics } from '../types';
import { calculateMetrics } from './metrics';

export interface CalibrationFitResult {
  calibration: Calibration;
  rawMetrics: Metrics;
  tunedMetrics: Metrics;
  shouldUse: boolean;
}

export function fitLinearCalibration(rows: BacktestRow[]): CalibrationFitResult {
  if (rows.length < 3) {
    const fallback = { alpha: 0, beta: 1 };
    return {
      calibration: fallback,
      rawMetrics: calculateMetrics(rows, 'rawEstimatePct'),
      tunedMetrics: calculateMetrics(rows, 'rawEstimatePct'),
      shouldUse: false,
    };
  }

  const n = rows.length;
  const meanRaw = rows.reduce((sum, row) => sum + row.rawEstimatePct, 0) / n;
  const meanActual = rows.reduce((sum, row) => sum + row.actualPct, 0) / n;
  const varianceRaw = rows.reduce((sum, row) => sum + (row.rawEstimatePct - meanRaw) ** 2, 0);

  if (varianceRaw === 0) {
    const fallback = { alpha: meanActual, beta: 0 };
    return withMetrics(rows, fallback);
  }

  const covariance = rows.reduce(
    (sum, row) => sum + (row.rawEstimatePct - meanRaw) * (row.actualPct - meanActual),
    0,
  );

  const beta = covariance / varianceRaw;
  const alpha = meanActual - beta * meanRaw;

  return withMetrics(rows, { alpha, beta });
}

function withMetrics(rows: BacktestRow[], calibration: Calibration): CalibrationFitResult {
  const tunedRows = rows.map((row) => ({
    ...row,
    tunedEstimatePct: calibration.alpha + calibration.beta * row.rawEstimatePct,
  }));
  const rawMetrics = calculateMetrics(rows, 'rawEstimatePct');
  const tunedMetrics = calculateMetrics(tunedRows, 'tunedEstimatePct');

  return {
    calibration,
    rawMetrics,
    tunedMetrics,
    shouldUse: tunedMetrics.mae < rawMetrics.mae,
  };
}