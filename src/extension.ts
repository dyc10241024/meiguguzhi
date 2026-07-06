import * as vscode from "vscode";
import { QdiiViewProvider } from "./webview/QdiiViewProvider";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("QDII Valuation");
  output.appendLine("activate");
  context.subscriptions.push(output);

  const provider = new QdiiViewProvider(context, output);

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

  // 阶段1：激活时自动打开侧边栏
  output.appendLine("auto-opening sidebar");
  void vscode.commands.executeCommand("workbench.view.extension.meiguguzhi");

  context.subscriptions.push(
    vscode.commands.registerCommand("meiguguzhi.open", async () => {
      output.appendLine("command open");
      await vscode.commands.executeCommand(
        "workbench.view.extension.meiguguzhi",
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("meiguguzhi.refresh", () => {
      output.appendLine("command refresh");
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("meiguguzhi.debugApi", (key?: string) => {
      output.appendLine("command debugApi: " + String(key));
      void provider.runDebugApi(key);
    }),
  );
}

export function deactivate() {
  // No-op.
}
