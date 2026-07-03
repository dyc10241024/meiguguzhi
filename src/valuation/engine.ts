import type {
  EstimateResult,
  FullHoldingsInput,
  HoldingInput,
  NormalizedTop10Input,
  SectorCompensatedInput,
  SectorExposureInput,
} from '../types';

function sumKnownContribution(holdings: HoldingInput[]): number {
  return holdings.reduce((sum, holding) => sum + holding.weight * holding.returnPct, 0);
}

function sumWeight(holdings: HoldingInput[]): number {
  return holdings.reduce((sum, holding) => sum + holding.weight, 0);
}

function applyCalibration(rawPct: number, alpha: number, beta: number): number {
  return alpha + beta * rawPct;
}

function sectorReturn(sectorExposures: SectorExposureInput[]): number {
  const totalExposure = sectorExposures.reduce((sum, item) => sum + item.exposure, 0);
  if (totalExposure <= 0) {
    return 0;
  }

  return sectorExposures.reduce((sum, item) => sum + (item.exposure / totalExposure) * item.returnPct, 0);
}

export function estimateFullHoldings(input: FullHoldingsInput): EstimateResult {
  const knownWeight = sumWeight(input.holdings);
  const knownContributionPct = sumKnownContribution(input.holdings);
  const unknownWeight = Math.max(input.equityWeight - knownWeight, 0);
  const unknownContributionPct = unknownWeight * input.proxyReturnPct;
  const rawPct = knownContributionPct + unknownContributionPct + input.fxContributionPct;
  const finalPct = applyCalibration(rawPct, input.calibration.alpha, input.calibration.beta);

  return {
    mode: 'full-holdings',
    rawPct,
    finalPct,
    knownContributionPct,
    unknownContributionPct,
    knownWeight,
    unknownWeight,
  };
}

export function estimateSectorCompensated(input: SectorCompensatedInput): EstimateResult {
  const knownWeight = sumWeight(input.knownHoldings);
  const knownContributionPct = sumKnownContribution(input.knownHoldings);
  const unknownWeight = Math.max(input.equityWeight - knownWeight, 0);
  const proxyReturnPct = sectorReturn(input.sectorExposures);
  const unknownContributionPct = unknownWeight * proxyReturnPct;
  const rawPct = knownContributionPct + unknownContributionPct + input.fxContributionPct;
  const finalPct = applyCalibration(rawPct, input.calibration.alpha, input.calibration.beta);

  return {
    mode: 'sector-compensated',
    rawPct,
    finalPct,
    knownContributionPct,
    unknownContributionPct,
    knownWeight,
    unknownWeight,
  };
}

export function estimateNormalizedTop10(input: NormalizedTop10Input): EstimateResult {
  const knownWeight = sumWeight(input.holdings);
  const knownContributionPct = sumKnownContribution(input.holdings);
  const normalizedHoldingReturnPct = knownWeight > 0 ? knownContributionPct / knownWeight : 0;
  const unknownWeight = Math.max(input.equityWeight - knownWeight, 0);
  const unknownContributionPct = unknownWeight * normalizedHoldingReturnPct;
  const equityContributionPct = normalizedHoldingReturnPct * input.equityWeight;
  const rawPct = equityContributionPct + input.fxContributionPct;
  const finalPct = applyCalibration(rawPct, input.calibration.alpha, input.calibration.beta);

  return {
    mode: 'normalized-top10',
    rawPct,
    finalPct,
    knownContributionPct,
    unknownContributionPct,
    knownWeight,
    unknownWeight,
    normalizedHoldingReturnPct,
    equityWeight: input.equityWeight,
    fxContributionPct: input.fxContributionPct,
  };
}
