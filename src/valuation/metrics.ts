import type { BacktestRow, Metrics } from '../types';

export function calculateMetrics(rows: BacktestRow[], estimateKey: 'rawEstimatePct' | 'tunedEstimatePct'): Metrics {
  if (rows.length === 0) {
    return {
      sampleCount: 0,
      mae: 0,
      rmse: 0,
      bias: 0,
      directionCorrect: 0,
    };
  }

  const errors = rows.map((row) => row[estimateKey] - row.actualPct);
  const absErrorSum = errors.reduce((sum, error) => sum + Math.abs(error), 0);
  const squareErrorSum = errors.reduce((sum, error) => sum + error * error, 0);
  const errorSum = errors.reduce((sum, error) => sum + error, 0);
  const directionCorrect = rows.filter((row) => sameDirection(row[estimateKey], row.actualPct)).length;

  return {
    sampleCount: rows.length,
    mae: absErrorSum / rows.length,
    rmse: Math.sqrt(squareErrorSum / rows.length),
    bias: errorSum / rows.length,
    directionCorrect,
  };
}

export function sameDirection(estimate: number, actual: number): boolean {
  if (Math.abs(estimate) < 0.005 && Math.abs(actual) < 0.005) {
    return true;
  }

  return Math.sign(estimate) === Math.sign(actual);
}

export function formatPct(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatMetric(value: number): string {
  return value.toFixed(3);
}
