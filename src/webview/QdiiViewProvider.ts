import * as childProcess from "child_process";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";
import { loadBacktestFixture } from "../data/fixture";
import { calculateMetrics } from "../valuation/metrics";

const FUND_NAMES: Record<string, string> = {
  "270023": "\u5e7f\u53d1\u5168\u7403\u7cbe\u9009",
  "501226": "\u957f\u57ce\u5168\u7403\u65b0\u80fd\u6e90\u8f66",
  "017436": "\u534e\u5b9d\u7eb3\u65af\u8fbe\u514b\u7cbe\u9009",
};

const FUND_FULL_POSITION_PARAMS: Record<
  string,
  { year: string; month: string }
> = {
  "270023": { year: "2025", month: "12" },
  "501226": { year: "2025", month: "12" },
  "017436": { year: "2025", month: "12" },
};

const MARKET_ITEMS = [
  { label: "\u7eb3\u65af\u8fbe\u514b", value: "-0.80%" },
  { label: "\u7eb3\u65af\u8fbe\u514b 100", value: "-1.61%" },
  { label: "\u6807\u666e 500", value: "--" },
  { label: "\u7f8e\u5143/\u4eba\u6c11\u5e01", value: "-0.10%" },
  { label: "\u66f4\u65b0\u65f6\u95f4", value: "2026-07-03 04:00" },
];

const LATEST_BEIJING_TIME = "2026-07-03 04:00";
const LATEST_TRADE_DATE = "2026-07-02";
const FX_RETURN_PCT = -0.1;

type AnyFund = Record<string, any>;

interface Holding {
  rank: number;
  secid: string;
  code: string;
  name: string;
  weightPct: number;
  returnPct?: number | null;
  contributionPct?: number | null;
  source?: string;
}

export class QdiiViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "meiguguzhi.view";

  private view?: vscode.WebviewView;

  private panel?: vscode.WebviewPanel;

  private resolved = false;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  public isResolved(): boolean {
    return this.resolved;
  }

  // 备用方案：把内容开在编辑器标签页里的 WebviewPanel，绕开侧边栏 WebviewView 不 resolve 的问题。
  public openPanel(): void {
    this.output.appendLine("openPanel");
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      void this.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "meiguguzhi.panel",
      "QDII 估值",
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, "media"),
        ],
      },
    );
    this.panel = panel;
    panel.webview.html = this.getHtml(panel.webview);
    this.output.appendLine("panel html assigned");

    panel.webview.onDidReceiveMessage((message: { type: string }) => {
      this.output.appendLine("panel message: " + message.type);
      if (message.type === "ready" || message.type === "refresh") {
        void this.refresh();
      }
    });

    panel.onDidDispose(() => {
      this.output.appendLine("panel disposed");
      this.panel = undefined;
    });

    void this.refresh();
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    // 诊断：用弹窗确认 resolveWebviewView 确实被调用（不可能被日志截断错过）
    void vscode.window.showInformationMessage(
      "QDII: resolveWebviewView 已触发",
    );
    this.output.appendLine("resolveWebviewView");
    this.resolved = true;
    this.view = webviewView;
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine("resolveWebviewView error: " + message);
      void vscode.window.showErrorMessage("QDII: resolve 出错 " + message);
    }
  }

  private webviewTargets(): vscode.Webview[] {
    const targets: vscode.Webview[] = [];
    if (this.view) {
      targets.push(this.view.webview);
    }
    if (this.panel) {
      targets.push(this.panel.webview);
    }
    return targets;
  }

  private async postToAll(message: unknown): Promise<void> {
    await Promise.all(
      this.webviewTargets().map((webview) => webview.postMessage(message)),
    );
  }

  public async refresh(): Promise<void> {
    this.output.appendLine("refresh");
    if (this.webviewTargets().length === 0) {
      return;
    }

    try {
      this.output.appendLine("refresh step: run live-data child process");
      const payload = await runLiveDataScript(this.context.extensionPath);
      this.output.appendLine(
        "posting data: algorithm1=" +
          payload.modes.algorithm1.length +
          ", algorithm3=" +
          payload.modes.algorithm3.length,
      );
      await this.postToAll({ type: "data", payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.output.appendLine("refresh error: " + message);
      await this.postToAll({ type: "error", payload: { message } });
    }
  }
  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "main.js"),
    );
    const nonce = getNonce();

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
}

function runLiveDataScript(extensionPath: string): Promise<AnyFund> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(extensionPath, "scripts", "live-data.js");
    childProcess.execFile(
      "node",
      [scriptPath, extensionPath],
      {
        cwd: extensionPath,
        timeout: 45000,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
      (error: Error | null, stdout: string, stderr: string) => {
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
                stdout.slice(0, 500),
            ),
          );
        }
      },
    );
  });
}
function buildEstimatedFund(
  source: AnyFund,
  holdings: Holding[],
  mode: "algorithm1" | "algorithm3",
  sourceName: string,
): AnyFund {
  const available = holdings.filter(
    (holding) =>
      typeof holding.returnPct === "number" &&
      Number.isFinite(holding.returnPct),
  );
  const knownWeightPct = sum(available.map((holding) => holding.weightPct));
  const knownContributionPct = sum(
    available.map((holding) => holding.contributionPct ?? 0),
  );
  const stockStyleReturnPct =
    knownWeightPct > 0 ? (knownContributionPct / knownWeightPct) * 100 : 0;
  const equityLikePct = Number(
    source.assetAllocation?.equityLikePct ??
      source.assetAllocation?.stockPct ??
      0,
  );
  const rawEstimatePct =
    stockStyleReturnPct * (equityLikePct / 100) + FX_RETURN_PCT;
  const alpha = Number(source.calibration?.alpha ?? 0);
  const beta = Number(source.calibration?.beta ?? 1);
  const tunedEstimatePct = alpha + beta * rawEstimatePct;

  return normalizeFund({
    ...source,
    mode,
    name: FUND_NAMES[source.code] ?? source.name,
    source: sourceName,
    reportDate:
      mode === "algorithm3" ? "2026-03-31" : "2025-12-31 + 2026-03-31 top10",
    dataFetchedAt: new Date().toISOString(),
    holdings,
    latestEstimate: {
      tradeDate: LATEST_TRADE_DATE,
      beijingTime: LATEST_BEIJING_TIME,
      holdingCount: holdings.length,
      holdingWeightPct: sum(holdings.map((holding) => holding.weightPct)),
      availableHoldingCount: available.length,
      availableWeightPct: knownWeightPct,
      stockStyleReturnPct,
      fxPct: FX_RETURN_PCT,
      rawEstimatePct,
      tunedEstimatePct,
      missing: holdings
        .filter((holding) => typeof holding.returnPct !== "number")
        .map((holding) => holding.secid),
    },
    calculatedMetrics: {
      raw: calculateMetrics(source.rows, "rawEstimatePct"),
      tuned: calculateMetrics(source.rows, "tunedEstimatePct"),
    },
  });
}

function buildFallbackHoldings(fund: AnyFund): Holding[] {
  const topWeightPct = Number(fund.latestEstimate?.topWeightPct ?? 0);
  const stockStyleReturnPct = Number(
    fund.latestEstimate?.stockStyleReturnPct ?? 0,
  );
  if (!topWeightPct) {
    return [];
  }
  return [
    {
      rank: 1,
      secid: "fallback-top10-normalized",
      code: "fallback",
      name: "\u672c\u5730\u56de\u6d4b\u515c\u5e95\u7ec4\u5408",
      weightPct: topWeightPct,
      returnPct: stockStyleReturnPct,
      contributionPct: (topWeightPct * stockStyleReturnPct) / 100,
      source: "fallback",
    },
  ];
}

function buildHybridHoldings(
  fullHoldings: Holding[],
  latestTop10: Holding[],
): Holding[] {
  const replaced = new Set(latestTop10.map((holding) => holding.secid));
  const merged = [
    ...latestTop10.map((holding) => ({ ...holding, source: "latest-top10" })),
    ...fullHoldings
      .filter((holding) => !replaced.has(holding.secid))
      .map((holding) => ({ ...holding, source: "full-2025q4" })),
  ];
  return merged
    .sort((left, right) => right.weightPct - left.weightPct)
    .map((holding, index) => ({ ...holding, rank: index + 1 }));
}

function applyQuotes(
  holdings: Holding[],
  quotes: Map<string, number>,
): Holding[] {
  return holdings.map((holding) => {
    const returnPct = holding.returnPct ?? quotes.get(holding.secid);
    return {
      ...holding,
      returnPct: typeof returnPct === "number" ? returnPct : null,
      contributionPct:
        typeof returnPct === "number"
          ? (holding.weightPct * returnPct) / 100
          : null,
    };
  });
}

async function fetchFundHoldings(
  code: string,
  params: { topline: number; year: string; month: string },
): Promise<Holding[]> {
  const url =
    "https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc" +
    "&code=" +
    encodeURIComponent(code) +
    "&topline=" +
    params.topline +
    "&year=" +
    encodeURIComponent(params.year) +
    "&month=" +
    encodeURIComponent(params.month) +
    "&rt=" +
    Date.now();
  const text = await httpsGetText(
    url,
    "https://fundf10.eastmoney.com/ccmx_" + code + ".html",
    "gbk",
  );
  const firstTable = firstBoxTable(text);
  return parseHoldingRows(firstTable).map(sanitizeHolding);
}

async function fetchQuoteReturns(
  secids: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  for (const group of chunk(secids, 80)) {
    const url =
      "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14&secids=" +
      group.join(",");
    const json = JSON.parse(
      await httpsGetText(url, "https://quote.eastmoney.com/", "utf-8"),
    ) as AnyFund;
    const rows = Array.isArray(json.data?.diff) ? json.data.diff : [];
    rows.forEach((row: AnyFund) => {
      const value = Number(row.f3);
      const code = String(row.f12 ?? "");
      const secid = group.find((item) => item.endsWith("." + code));
      if (secid && Number.isFinite(value) && value > -90) {
        result.set(secid, value);
      }
    });
  }
  return result;
}

function parseHoldingRows(html: string): Holding[] {
  const rows = html.match(/<tr><td>\d+<\/td>[\s\S]*?<\/tr>/g) ?? [];
  return rows
    .map((row) => {
      const rank = Number(row.match(/<tr><td>(\d+)<\/td>/)?.[1] ?? 0);
      const links = Array.from(
        row.matchAll(
          /<a href='\/\/quote\.eastmoney\.com\/unify\/r\/([^']+)' ?>([^<]+)<\/a>/g,
        ),
      );
      const cells = Array.from(
        row.matchAll(/<td class='toc'[^>]*>([\s\S]*?)<\/td>/g),
      ).map((match) => stripHtml(match[1]));
      const weightText = cells.find((cell) => /^\d+(\.\d+)?%$/.test(cell));
      return {
        rank,
        secid: links[0]?.[1] ?? "",
        code: links[0]?.[2] ?? "",
        name: links[1]?.[2] ?? "",
        weightPct: weightText ? Number(weightText.replace("%", "")) : 0,
      };
    })
    .filter(
      (holding) => holding.rank > 0 && holding.secid && holding.weightPct > 0,
    );
}

function firstBoxTable(text: string): string {
  const firstBox = text.split("<div class='boxitem w790'>")[1] ?? text;
  const table = firstBox.match(/<table[\s\S]*?<\/table>/)?.[0];
  return table ?? firstBox;
}

function httpsGetText(
  url: string,
  referer: string,
  charset: string = "utf-8",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        timeout: 8000,
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: referer,
        },
      },
      (response) => {
        if (response.statusCode && response.statusCode >= 400) {
          response.resume();
          reject(
            new Error("request failed " + response.statusCode + ": " + url),
          );
          return;
        }
        // 东财基金档案页为 GBK 编码，行情接口为 UTF-8，需按 charset 解码避免中文乱码
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => {
          chunks.push(chunk as Buffer);
        });
        response.on("end", () => {
          try {
            const decoder = new TextDecoder(charset);
            resolve(decoder.decode(Buffer.concat(chunks)));
          } catch (error) {
            reject(error as Error);
          }
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(new Error("request timeout: " + url));
    });
    request.on("error", reject);
  });
}

function normalizeFund(fund: AnyFund): AnyFund {
  const latest = fund.latestEstimate ?? fund.rows?.[fund.rows.length - 1] ?? {};
  return {
    ...fund,
    latestEstimate: latest,
    dataFetchedAt: fund.dataFetchedAt ?? latest.beijingTime,
  };
}

function sanitizeHolding(holding: Holding): Holding {
  return {
    ...holding,
    name: holding.name || holding.code || holding.secid,
  };
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunk<T>(values: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
