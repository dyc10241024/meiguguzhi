const fs = require("fs");
const path = require("path");
const https = require("https");

const root = process.argv[2] || process.cwd();
const FUND_NAMES = {
  270023: "广发全球精选",
  501226: "长城全球新能源车",
  "017436": "华宝纳斯达克精选",
};
const FULL_PARAMS = {
  270023: { year: "2025", month: "12" },
  501226: { year: "2025", month: "12" },
  "017436": { year: "2025", month: "12" },
};
// 顶部指标与汇率的东财 secid（已通过接口核实名称）
const MARKET_SECIDS = {
  nasdaq: "100.NDX", // 纳斯达克综合指数
  nasdaq100: "100.NDX100", // 纳斯达克100指数
  sp500: "100.SPX", // 标普500指数
  usdcnh: "133.USDCNH", // 美元兑离岸人民币
};
const FX_RETURN_PCT_FALLBACK = -0.1; // 汇率接口失败时的兜底涨跌幅

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

async function main() {
  const fixture = JSON.parse(
    fs.readFileSync(path.join(root, "data", "backtest-20d.json"), "utf8"),
  );
  const funds = fixture.funds || [];
  const latestTopByCode = new Map();
  const hybridByCode = new Map();

  for (const fund of funds) {
    const top = await fetchFundHoldings(fund.code, {
      topline: 10,
      year: "",
      month: "",
    });
    latestTopByCode.set(fund.code, top);
    const params = FULL_PARAMS[fund.code] || { year: "2025", month: "12" };
    const full = await fetchFundHoldings(fund.code, {
      topline: 1000,
      ...params,
    });
    hybridByCode.set(fund.code, buildHybridHoldings(full, top));
  }

  const allSecids = unique([
    ...Array.from(latestTopByCode.values())
      .flat()
      .map((h) => h.secid),
    ...Array.from(hybridByCode.values())
      .flat()
      .map((h) => h.secid),
  ]);
  const quotes = await fetchQuoteReturns(allSecids);
  const market = await fetchMarketData();

  const algorithm3 = funds.map((fund) =>
    buildEstimatedFund(
      fund,
      applyQuotes(latestTopByCode.get(fund.code) || [], quotes),
      "algorithm3",
      "latest-quarter-top10",
      market,
    ),
  );
  const algorithm1 = funds.map((fund) =>
    buildEstimatedFund(
      fund,
      applyQuotes(hybridByCode.get(fund.code) || [], quotes),
      "algorithm1",
      "full-2025q4-plus-latest-top10",
      market,
    ),
  );

  process.stdout.write(
    JSON.stringify({
      market: { updatedAt: market.updatedAt, items: market.items },
      modes: { algorithm1, algorithm3 },
      meta: {
        generatedAt: new Date().toISOString(),
        dataWindow: fixture.dataWindow,
        algorithm3: fixture.algorithm,
      },
    }),
  );
}

function buildEstimatedFund(source, holdings, mode, sourceName, market) {
  const available = holdings.filter(
    (h) => typeof h.returnPct === "number" && Number.isFinite(h.returnPct),
  );
  const knownWeightPct = sum(available.map((h) => h.weightPct));
  const knownContributionPct = sum(
    available.map((h) => h.contributionPct || 0),
  );
  const stockStyleReturnPct =
    knownWeightPct > 0 ? (knownContributionPct / knownWeightPct) * 100 : 0;
  const equityLikePct = Number(
    (source.assetAllocation &&
      (source.assetAllocation.equityLikePct ||
        source.assetAllocation.stockPct)) ||
      0,
  );
  const fxPct = market.fxPct;
  const rawEstimatePct = stockStyleReturnPct * (equityLikePct / 100) + fxPct;
  const alpha = Number((source.calibration && source.calibration.alpha) || 0);
  const beta = Number((source.calibration && source.calibration.beta) || 1);
  const tunedEstimatePct = alpha + beta * rawEstimatePct;
  return {
    ...source,
    mode,
    name: FUND_NAMES[source.code] || source.name,
    source: sourceName,
    reportDate:
      mode === "algorithm3" ? "2026-03-31" : "2025-12-31 + 2026-03-31 top10",
    dataFetchedAt: new Date().toISOString(),
    holdings,
    latestEstimate: {
      tradeDate: market.updatedAt.slice(0, 10),
      beijingTime: market.updatedAt,
      holdingCount: holdings.length,
      holdingWeightPct: sum(holdings.map((h) => h.weightPct)),
      availableHoldingCount: available.length,
      availableWeightPct: knownWeightPct,
      stockStyleReturnPct,
      fxPct,
      rawEstimatePct,
      tunedEstimatePct,
      missing: holdings
        .filter((h) => typeof h.returnPct !== "number")
        .map((h) => h.secid),
    },
    calculatedMetrics: {
      raw: calculateMetrics(source.rows, "rawEstimatePct"),
      tuned: calculateMetrics(source.rows, "tunedEstimatePct"),
    },
  };
}

function calculateMetrics(rows, estimateKey) {
  const sample = (rows || []).filter(
    (row) =>
      typeof row.actualPct === "number" && typeof row[estimateKey] === "number",
  );
  if (!sample.length)
    return { sampleCount: 0, mae: 0, rmse: 0, bias: 0, directionCorrect: 0 };
  let abs = 0,
    sq = 0,
    bias = 0,
    dir = 0;
  for (const row of sample) {
    const error = row[estimateKey] - row.actualPct;
    abs += Math.abs(error);
    sq += error * error;
    bias += error;
    if (Math.sign(row[estimateKey]) === Math.sign(row.actualPct)) dir += 1;
  }
  return {
    sampleCount: sample.length,
    mae: abs / sample.length,
    rmse: Math.sqrt(sq / sample.length),
    bias: bias / sample.length,
    directionCorrect: dir,
  };
}

function buildHybridHoldings(fullHoldings, latestTop10) {
  const replaced = new Set(latestTop10.map((h) => h.secid));
  return [
    ...latestTop10.map((h) => ({ ...h, source: "latest-top10" })),
    ...fullHoldings
      .filter((h) => !replaced.has(h.secid))
      .map((h) => ({ ...h, source: "full-2025q4" })),
  ]
    .sort((a, b) => b.weightPct - a.weightPct)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

function applyQuotes(holdings, quotes) {
  return holdings.map((h) => {
    const returnPct = quotes.get(h.secid);
    return {
      ...h,
      returnPct: typeof returnPct === "number" ? returnPct : null,
      contributionPct:
        typeof returnPct === "number" ? (h.weightPct * returnPct) / 100 : null,
    };
  });
}

async function fetchFundHoldings(code, params) {
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
  return parseHoldingRows(firstBoxTable(text));
}

async function fetchQuoteReturns(secids) {
  const result = new Map();
  for (const group of chunk(secids, 80)) {
    const url =
      "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f3,f12,f14&secids=" +
      group.join(",");
    const json = JSON.parse(
      await httpsGetText(url, "https://quote.eastmoney.com/", "utf-8"),
    );
    const rows = Array.isArray(json.data && json.data.diff)
      ? json.data.diff
      : [];
    for (const row of rows) {
      const value = Number(row.f3);
      const code = String(row.f12 || "");
      const secid = group.find((item) => item.endsWith("." + code));
      if (secid && Number.isFinite(value) && value > -90)
        result.set(secid, value);
    }
  }
  return result;
}

function parseHoldingRows(html) {
  const rows = html.match(/<tr><td>\d+<\/td>[\s\S]*?<\/tr>/g) || [];
  return rows
    .map((row) => {
      const rank = Number((row.match(/<tr><td>(\d+)<\/td>/) || [])[1] || 0);
      const links = Array.from(
        row.matchAll(
          /<a href='\/\/quote\.eastmoney\.com\/unify\/r\/([^']+)' ?>([^<]+)<\/a>/g,
        ),
      );
      const cells = Array.from(
        row.matchAll(/<td class='toc'[^>]*>([\s\S]*?)<\/td>/g),
      ).map((m) => stripHtml(m[1]));
      const weightText = cells.find((cell) => /^\d+(\.\d+)?%$/.test(cell));
      return {
        rank,
        secid: (links[0] && links[0][1]) || "",
        code: (links[0] && links[0][2]) || "",
        name: (links[1] && links[1][2]) || "",
        weightPct: weightText ? Number(weightText.replace("%", "")) : 0,
      };
    })
    .filter((h) => h.rank > 0 && h.secid && h.weightPct > 0);
}

function firstBoxTable(text) {
  const firstBox = text.split("<div class='boxitem w790'>")[1] || text;
  const table = firstBox.match(/<table[\s\S]*?<\/table>/);
  return table ? table[0] : firstBox;
}

// 拉取顶部四大指标 + 汇率，返回展示项、实时汇率涨跌幅与更新时间
async function fetchMarketData() {
  const secids = [
    MARKET_SECIDS.nasdaq,
    MARKET_SECIDS.nasdaq100,
    MARKET_SECIDS.sp500,
    MARKET_SECIDS.usdcnh,
  ];
  const url =
    "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13,f14&secids=" +
    secids.join(",");
  const pctBySecid = new Map();
  try {
    const json = JSON.parse(
      await httpsGetText(url, "https://quote.eastmoney.com/", "utf-8"),
    );
    const rows = Array.isArray(json.data && json.data.diff)
      ? json.data.diff
      : [];
    for (const row of rows) {
      pctBySecid.set(row.f13 + "." + row.f12, Number(row.f3));
    }
  } catch (error) {
    // 指标拉取失败时降级为占位，不阻断整体估值
  }

  const fmt = (secid) => {
    const v = pctBySecid.get(secid);
    return typeof v === "number" && Number.isFinite(v)
      ? (v > 0 ? "+" : "") + v.toFixed(2) + "%"
      : "--";
  };
  const usdcnhPct = pctBySecid.get(MARKET_SECIDS.usdcnh);
  const fxPct =
    typeof usdcnhPct === "number" && Number.isFinite(usdcnhPct)
      ? usdcnhPct
      : FX_RETURN_PCT_FALLBACK;
  const updatedAt = beijingNow();
  return {
    updatedAt,
    fxPct,
    items: [
      { label: "纳斯达克指数", value: fmt(MARKET_SECIDS.nasdaq) },
      { label: "纳斯达克100指数", value: fmt(MARKET_SECIDS.nasdaq100) },
      { label: "标普500指数", value: fmt(MARKET_SECIDS.sp500) },
      { label: "美元人民币汇率", value: fmt(MARKET_SECIDS.usdcnh) },
      { label: "数据更新时间", value: updatedAt },
    ],
  };
}

// 当前北京时间（UTC+8），格式 YYYY-MM-DD HH:mm
function beijingNow() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    now.getUTCFullYear() +
    "-" +
    p(now.getUTCMonth() + 1) +
    "-" +
    p(now.getUTCDate()) +
    " " +
    p(now.getUTCHours()) +
    ":" +
    p(now.getUTCMinutes())
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 东财接口偶发 socket hang up / 限流，带指数退避重试
async function httpsGetText(url, referer, charset) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await httpsGetTextOnce(url, referer, charset);
    } catch (error) {
      lastError = error;
      await sleep(attempt * 600);
    }
  }
  throw lastError;
}

function httpsGetTextOnce(url, referer, charset) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        timeout: 12000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Connection: "keep-alive",
          Referer: referer,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          reject(new Error("request failed " + res.statusCode + ": " + url));
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            // 东财基金档案页为 GBK 编码，行情接口为 UTF-8，需按 charset 解码避免中文乱码
            const decoder = new TextDecoder(charset || "utf-8");
            resolve(decoder.decode(Buffer.concat(chunks)));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timeout: " + url)));
    req.on("error", reject);
  });
}

function stripHtml(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}
function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}
function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
function chunk(values, size) {
  const groups = [];
  for (let i = 0; i < values.length; i += size)
    groups.push(values.slice(i, i + size));
  return groups;
}
