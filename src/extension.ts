import * as vscode from 'vscode';
import { loadBacktestFixture } from './data/fixture';
import { calculateMetrics } from './valuation/metrics';
import { QdiiViewProvider } from './webview/QdiiViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('QDII Valuation');
  output.appendLine('activate');
  context.subscriptions.push(output);

  const provider = new QdiiViewProvider(context, output);
  const revealView = async (reason: string) => {
    output.appendLine('reveal view start: ' + reason);
    try {
      await vscode.commands.executeCommand('workbench.view.extension.meiguguzhi');
      output.appendLine('container opened');
    } catch (error) {
      output.appendLine('container open failed: ' + String(error));
    }

    try {
      await vscode.commands.executeCommand(QdiiViewProvider.viewType + '.focus');
      output.appendLine('view focus sent');
    } catch (error) {
      output.appendLine('view focus failed: ' + String(error));
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(QdiiViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );
  output.appendLine('registered webview provider: ' + QdiiViewProvider.viewType);
  [300, 1200, 2500].forEach((delay) => {
    setTimeout(() => {
      void revealView('auto ' + delay + 'ms');
    }, delay);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('meiguguzhi.open', async () => {
      output.appendLine('command open');
      await revealView('command');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('meiguguzhi.refresh', () => {
      output.appendLine('command refresh');
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('meiguguzhi.backtest', () => {
      output.appendLine('command backtest');
      const fixture = loadBacktestFixture(context.extensionPath);
      const lines = fixture.funds.map((fund) => {
        const tuned = calculateMetrics(fund.rows, 'tunedEstimatePct');
        return `${fund.code} ${fund.name}: MAE ${tuned.mae.toFixed(3)}, RMSE ${tuned.rmse.toFixed(3)}, Direction ${tuned.directionCorrect}/${tuned.sampleCount}`;
      });

      vscode.window.showInformationMessage(lines.join(' | '));
    }),
  );
}

export function deactivate() {
  // No-op.
}
