import * as path from 'path';
import { loadBacktestFixture } from '../data/fixture';
import { calculateMetrics, formatMetric } from '../valuation/metrics';
import { fitLinearCalibration } from '../valuation/calibration';

const rootPath = path.resolve(__dirname, '..', '..');
const fixture = loadBacktestFixture(rootPath);

console.log(`\n${fixture.name}`);
console.log(`${fixture.dataWindow.startNavDate} -> ${fixture.dataWindow.endNavDate}, ${fixture.dataWindow.navDays} days\n`);

for (const fund of fixture.funds) {
  const raw = calculateMetrics(fund.rows, 'rawEstimatePct');
  const tuned = calculateMetrics(fund.rows, 'tunedEstimatePct');

  console.log(`${fund.code} ${fund.name}`);
  console.log(`  raw   MAE ${formatMetric(raw.mae)}  RMSE ${formatMetric(raw.rmse)}  Bias ${formatMetric(raw.bias)}  Dir ${raw.directionCorrect}/${raw.sampleCount}`);
  const fitted = fitLinearCalibration(fund.rows);
  console.log(`  tuned MAE ${formatMetric(tuned.mae)}  RMSE ${formatMetric(tuned.rmse)}  Bias ${formatMetric(tuned.bias)}  Dir ${tuned.directionCorrect}/${tuned.sampleCount}`);
  console.log(`  fit   alpha ${fitted.calibration.alpha.toFixed(4)}  beta ${fitted.calibration.beta.toFixed(4)}  MAE ${formatMetric(fitted.tunedMetrics.mae)}  use ${fitted.shouldUse ? 'yes' : 'no'}`);
  console.log('');
}
