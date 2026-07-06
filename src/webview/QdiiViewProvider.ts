import * as childProcess from "child_process";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";

type AnyFund = Record<string, any>;
type WebviewMessage = {
  type: string;
  key?: string;
};

const DEBUG_REPORT_PARAMS = getLatestReportCandidate();
const DEBUG_APIS: Record<
  string,
  { title: string; url: string; referer: string }
> = {
  market: {
    title: "顶部指标行情 push2",
    url: "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13,f14&secids=100.NDX,100.NDX100,100.SPX,133.USDCNH",
    referer: "https://quote.eastmoney.com/",
  },
  quotes: {
    title: "重仓股票行情 push2",
    url: "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13,f14&secids=105.ASML,116.02513,105.GOOG,105.NVDA,105.AAPL,105.TSM",
    referer: "https://quote.eastmoney.com/",
  },
  fundTop10: {
    title: "270023 最新十大持仓 fundf10",
    url: "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=270023&topline=10&year=&month=",
    referer: "https://fundf10.eastmoney.com/ccmx_270023.html",
  },
  fundFull: {
    title:
      "270023 最近候选全量持仓 fundf10 " +
      DEBUG_REPORT_PARAMS.year +
      "-" +
      DEBUG_REPORT_PARAMS.month,
    url:
      "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=270023&topline=1000&year=" +
      DEBUG_REPORT_PARAMS.year +
      "&month=" +
      DEBUG_REPORT_PARAMS.month,
    referer: "https://fundf10.eastmoney.com/ccmx_270023.html",
  },
};

function getLatestReportCandidate(): { year: string; month: string } {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const year = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  for (const month of [12, 9, 6, 3]) {
    if (month <= currentMonth) {
      return { year: String(year), month: String(month) };
    }
  }
  return { year: String(year - 1), month: "12" };
}

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
      enableCommandUris: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "media"),
      ],
    };

    webview.onDidReceiveMessage((message: WebviewMessage) => {
      this.output.appendLine("webview message: " + message.type);
      if (message.type === "ready" || message.type === "refresh") {
        void this.refresh();
      }
      if (message.type === "debugApi") {
        void this.runDebugApi(message.key);
      }
    });

    webview.html = this.getHtml(webview);
    this.output.appendLine("webview html assigned");

    this.output.appendLine("calling immediate refresh");
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    this.output.appendLine("refresh: loading live data");
    if (!this.view) {
      this.output.appendLine("refresh: no view");
      return;
    }

    try {
      const payload = await runLiveDataScript(this.context.extensionPath);
      this.output.appendLine(
        "posting live data: algorithm1=" +
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
      this.output.appendLine("refresh live error: " + message);
      await this.view.webview.postMessage({
        type: "error",
        payload: { message },
      });
    }
  }

  public async runDebugApi(key?: string): Promise<void> {
    if (!this.view) {
      this.output.appendLine("debug api: no view");
      return;
    }

    const api = key ? DEBUG_APIS[key] : undefined;
    if (!key || !api) {
      await this.view.webview.postMessage({
        type: "debugResult",
        payload: {
          ok: false,
          key,
          error: "unknown debug api",
        },
      });
      return;
    }

    this.output.appendLine("debug api start: " + key);
    await this.view.webview.postMessage({
      type: "debugResult",
      payload: {
        ok: null,
        key,
        title: api.title,
        url: api.url,
        requestedAt: new Date().toISOString(),
        status: "request accepted by extension host",
      },
    });

    try {
      const startedAt = Date.now();
      const response = await httpsGetText(api.url, api.referer);
      const json = tryParseJson(response.body);
      const holdingRowCount = (response.body.match(/<tr><td>\d+<\/td>/g) ?? [])
        .length;

      await this.view.webview.postMessage({
        type: "debugResult",
        payload: {
          ok: true,
          key,
          title: api.title,
          url: api.url,
          requestedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          statusCode: response.statusCode,
          contentType: response.contentType,
          holdingRowCount,
          json,
          bodyPreview: json ? undefined : response.body.slice(0, 5000),
        },
      });
      this.output.appendLine(
        "debug api done: " + key + " " + response.statusCode,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine("debug api error: " + key + " " + message);
      await this.view.webview.postMessage({
        type: "debugResult",
        payload: {
          ok: false,
          key,
          title: api.title,
          url: api.url,
          requestedAt: new Date().toISOString(),
          error: message,
        },
      });
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const cacheBust = "?v=" + Date.now();
    const styleUri =
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"),
      ) + cacheBust;
    const scriptUri =
      webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"),
      ) + cacheBust;
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
        <p id="subtitle">&#27491;&#22312;&#35835;&#21462;&#30495;&#23454;&#25509;&#21475;&#25968;&#25454;</p>
      </div>
      <div class="top-actions">
        <button id="debugButton" class="text-button" title="&#25509;&#21475;&#35843;&#35797;" aria-label="&#25509;&#21475;&#35843;&#35797;">&#35843;&#35797;</button>
        <button id="refreshButton" class="icon-button" title="&#21047;&#26032;" aria-label="&#21047;&#26032;">R</button>
      </div>
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

function httpsGetText(
  url: string,
  referer: string,
): Promise<{ body: string; statusCode: number; contentType: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(hardTimeout);
      callback();
    };
    const hardTimeout = setTimeout(() => {
      finish(() => reject(new Error("request hard timeout: " + url)));
    }, 15000);

    const request = https.get(
      url,
      {
        timeout: 12000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: referer,
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const contentType = String(response.headers["content-type"] ?? "");
        response.setEncoding("utf8");
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (statusCode >= 400) {
            finish(() =>
              reject(new Error("request failed " + statusCode + ": " + url)),
            );
            return;
          }
          finish(() => resolve({ body, statusCode, contentType }));
        });
      },
    );

    request.setTimeout(12000);
    request.on("timeout", () => {
      request.destroy(new Error("request timeout: " + url));
    });
    request.on("error", (error) => {
      finish(() => reject(error));
    });
  });
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function runLiveDataScript(extensionPath: string): Promise<AnyFund> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(extensionPath, "scripts", "live-data.js");
    childProcess.execFile(
      "node",
      [scriptPath, extensionPath],
      {
        cwd: extensionPath,
        timeout: 150000,
        maxBuffer: 50 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as AnyFund);
        } catch (parseError) {
          reject(
            new Error(
              "live-data parse failed: " +
                String(parseError) +
                "\n" +
                stdout.slice(0, 1000),
            ),
          );
        }
      },
    );
  });
}
