import * as vscode from "vscode";
import { loadBacktestFixture } from "./data/fixture";
import { calculateMetrics } from "./valuation/metrics";
import { QdiiViewProvider } from "./webview/QdiiViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("QDII Valuation");
  output.appendLine("activate");
  context.subscriptions.push(output);

  const provider = new QdiiViewProvider(context, output);
  const revealView = async (reason: string) => {
    output.appendLine("reveal view start: " + reason);
    try {
      await vscode.commands.executeCommand(
        "workbench.view.extension.meiguguzhi",
      );
      output.appendLine("container opened");
    } catch (error) {
      output.appendLine("container open failed: " + String(error));
    }

    try {
      await vscode.commands.executeCommand(
        QdiiViewProvider.viewType + ".focus",
      );
      output.appendLine("view focus sent");
    } catch (error) {
      output.appendLine("view focus failed: " + String(error));
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      QdiiViewProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      },
    ),
  );
  output.appendLine(
    "registered webview provider: " + QdiiViewProvider.viewType,
  );

  // 健壮的自动展开：反复尝试 reveal，直到视图真正 resolve 或达到上限，避免视图长期停在空白加载态。
  let revealAttempts = 0;
  const revealTimer = setInterval(() => {
    revealAttempts += 1;
    if (provider.isResolved() || revealAttempts > 15) {
      clearInterval(revealTimer);
      output.appendLine(
        "auto-reveal stopped: resolved=" +
          provider.isResolved() +
          ", attempts=" +
          revealAttempts,
      );
      if (!provider.isResolved()) {
        // 诊断：多次 reveal 后视图仍未 resolve，弹窗告警（不可能被日志截断错过）
        void vscode.window.showWarningMessage(
          "QDII: 视图 " +
            revealAttempts +
            " 次尝试后仍未 resolve（resolveWebviewView 未被调用）",
        );
      }
      return;
    }
    void revealView("auto attempt " + revealAttempts);
  }, 600);
  context.subscriptions.push({ dispose: () => clearInterval(revealTimer) });

  context.subscriptions.push(
    vscode.commands.registerCommand("meiguguzhi.open", async () => {
      output.appendLine("command open");
      // 优先用 WebviewPanel（编辑器标签页），最稳；同时尝试展开侧边栏视图。
      provider.openPanel();
      await revealView("command");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("meiguguzhi.refresh", () => {
      output.appendLine("command refresh");
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("meiguguzhi.backtest", () => {
      output.appendLine("command backtest");
      const fixture = loadBacktestFixture(context.extensionPath);
      const lines = fixture.funds.map((fund) => {
        const tuned = calculateMetrics(fund.rows, "tunedEstimatePct");
        return `${fund.code} ${fund.name}: MAE ${tuned.mae.toFixed(3)}, RMSE ${tuned.rmse.toFixed(3)}, Direction ${tuned.directionCorrect}/${tuned.sampleCount}`;
      });

      vscode.window.showInformationMessage(lines.join(" | "));
    }),
  );
}

export function deactivate() {
  // No-op.
}
