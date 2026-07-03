import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

type AnyFund = Record<string, any>;

export class QdiiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "meiguguzhi.view";

  private view?: vscode.WebviewView;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.output.appendLine("resolveWebviewView");
    this.view = webviewView;

    const { webview } = webviewView;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };

    webview.html = this.getHtml(webview);
    this.output.appendLine("webview html assigned");

    webview.onDidReceiveMessage((message: { type: string }) => {
      this.output.appendLine("webview message: " + message.type);
      if (message.type === "ready" || message.type === "refresh") {
        void this.refresh();
      }
    });

    this.output.appendLine("calling immediate refresh");
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    this.output.appendLine("refresh: loading mock data");
    if (!this.view) {
      this.output.appendLine("refresh: no view");
      return;
    }

    try {
      const mockPath = path.join(
        this.context.extensionPath,
        "data",
        "mock.json",
      );
      const mockContent = fs.readFileSync(mockPath, "utf-8");
      const payload = JSON.parse(mockContent) as AnyFund;
      this.output.appendLine(
        "posting mock data: algorithm1=" +
          payload.modes.algorithm1.length +
          ", algorithm3=" +
          payload.modes.algorithm3.length,
      );
      const success = await this.view.webview.postMessage({
        type: "data",
        payload,
      });
      this.output.appendLine("postMessage result: " + success);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine("refresh error: " + message);
      await this.view.webview.postMessage({
        type: "error",
        payload: { message },
      });
    }
  }
  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"),
    );
    const nonce = this.getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource} 'nonce-${nonce}'; img-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>QDII Valuation</title>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div>
        <h1>QDII &#20272;&#20540;</h1>
        <p id="subtitle">&#27491;&#22312;&#35835;&#21462;&#32447;&#19978;&#25968;&#25454;</p>
      </div>
      <button id="refreshButton" class="icon-button" title="&#21047;&#26032;" aria-label="&#21047;&#26032;">R</button>
    </header>

    <section id="marketBar" class="market-bar" aria-label="market indicators"></section>

    <nav class="tabs" aria-label="valuation algorithms">
      <button class="tab active" type="button" data-mode="algorithm3">&#31639;&#27861;3 &#24555;&#36895;&#20272;&#20540;</button>
      <button class="tab" type="button" data-mode="algorithm1">&#31639;&#27861;1 &#20840;&#37327;&#25345;&#20179;&#20272;&#20540;</button>
    </nav>

    <section id="fundList" class="fund-list" aria-label="fund list">
      <div class="empty-state">Loading...</div>
    </section>
  </main>

  <div id="modalBackdrop" class="modal-backdrop hidden">
    <section class="modal" role="dialog" aria-modal="true">
      <header class="modal-head">
        <div>
          <h2 id="modalTitle"></h2>
          <p id="modalMeta"></p>
        </div>
        <button id="modalClose" class="icon-button" type="button" title="&#20851;&#38381;" aria-label="&#20851;&#38381;">X</button>
      </header>
      <div id="modalBody" class="modal-body"></div>
    </section>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let text = "";
    for (let i = 0; i < 32; i += 1) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
