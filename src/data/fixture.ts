import * as fs from 'fs';
import * as path from 'path';
import type { BacktestFixture } from '../types';

export function loadBacktestFixture(rootPath: string): BacktestFixture {
  const filePath = path.join(rootPath, 'data', 'backtest-20d.json');
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text) as BacktestFixture;
}
