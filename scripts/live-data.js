const fs = require("fs");
const path = require("path");
const https = require("https");

const root = process.argv[2] || process.cwd();
const FUND_NAMES = {
  270023: "广发全球精选",
  501226: "长城全球新能源车",
  "017436": "华宝纳斯达克精选",
};
// 顶部指标与汇率的东财 secid（已通过接口核实名称）
const MARKET_SECIDS = {
  nasdaq: "100.NDX", // 纳斯达克综合指数
  nasdaq100: "100.NDX100", // 纳斯达克100指数
  sp500: "100.SPX", // 标普500指数
  usdcnh: "133.USDCNH", // 美元兑离岸人民币
};
const FX_RETURN_PCT_FALLBACK = -0.1; // 汇率接口失败时的兜底涨跌幅
const REQUEST_RETRY_LIMIT = 8;
const REQUEST_TIMEOUT_MS = 20000;
const MIN_FULL_HOLDING_COUNT = 20;

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});

async function main() {
  const fundConfig = JSON.parse(
    fs.readFileSync(path.join(root, "data", "funds.json"), "utf8"),
  );
  const funds = fundConfig.funds || [];
  const navHistoryByCode = new Map();
  for (const fund of funds) {
    const navHistory = await fetchFundNavHistory(fund.code, 25);
    navHistoryByCode.set(fund.code, navHistory);
    mergeActualNavRows(fund, navHistory.rows);
    await sleep(180);
  }
  const latestTopByCode = new Map();
  const hybridByCode = new Map();
  const topMetaByCode = new Map();
  const fullMetaByCode = new Map();

  for (const fund of funds) {
    const topResult = await fetchFundHoldings(fund.code, {
      topline: 10,
      year: "",
      month: "",
    });
    const top = topResult.holdings;
    latestTopByCode.set(fund.code, top);
    topMetaByCode.set(fund.code, topResult.meta);
    await sleep(250);
    const fullResult = await fetchLatestFullHoldings(fund.code);
    const full = fullResult.holdings;
    fullMetaByCode.set(fund.code, fullResult.meta);
    hybridByCode.set(fund.code, buildHybridHoldings(full, top));
    await sleep(350);
  }

  const allSecids = unique([
    ...Array.from(latestTopByCode.values())
      .flat()
      .map((h) => h.secid),
    ...Array.from(hybridByCode.values())
      .flat()
      .map((h) => h.secid),
  ]);
  const quoteResult = await fetchQuoteReturns(allSecids);
  const quotes = quoteResult.returns;
  const market = await fetchMarketData();
  const historyResult = await fetchHistoricalReturnMaps(
    [...allSecids, MARKET_SECIDS.usdcnh],
    Array.from(navHistoryByCode.values()).flatMap((history) => history.rows),
  );

  const algorithm3 = funds.map((fund) => {
    const holdings = applyQuotes(latestTopByCode.get(fund.code) || [], quotes);
    const backtest = buildDynamicBacktestRows(
      fund,
      holdings,
      navHistoryByCode.get(fund.code),
      historyResult.returns,
    );
    return buildEstimatedFund(
      { ...fund, ...backtest },
      holdings,
      "algorithm3",
      "latest-top10",
      market,
      {
        holdings: topMetaByCode.get(fund.code),
        quotes: quoteResult.meta,
        navHistory: navHistoryByCode.get(fund.code),
        historicalQuotes: historyResult.meta,
      },
    );
  });
  const algorithm1 = funds.map((fund) => {
    const holdings = applyQuotes(hybridByCode.get(fund.code) || [], quotes);
    const backtest = buildDynamicBacktestRows(
      fund,
      holdings,
      navHistoryByCode.get(fund.code),
      historyResult.returns,
    );
    return buildEstimatedFund(
      { ...fund, ...backtest },
      holdings,
      "algorithm1",
      "latest-full-plus-latest-top10",
      market,
      {
        holdings: fullMetaByCode.get(fund.code),
        latestTop10: topMetaByCode.get(fund.code),
        quotes: quoteResult.meta,
        navHistory: navHistoryByCode.get(fund.code),
        historicalQuotes: historyResult.meta,
      },
    );
  });

  process.stdout.write(
    JSON.stringify({
      market: { updatedAt: market.updatedAt, items: market.items },
      modes: { algorithm1, algorithm3 },
      meta: {
        generatedAt: new Date().toISOString(),
        historyWindow: historyResult.meta,
        dataSources: {
          market: market.source,
          quotes: quoteResult.meta,
          holdings: {
            top10:
              "东方财富 fundf10 FundArchivesDatas.aspx type=jjcc topline=10",
            full: "东方财富 fundf10 FundArchivesDatas.aspx type=jjcc topline=1000",
          },
          fundConfig: "?? data/funds.json???????????????",
          historicalQuotes:
            "???? push2his stock/kline/get???????????",
          navHistory:
            "东方财富 api.fund.eastmoney.com/f10/lsjz，用于历史回测实际净值涨跌幅",
        },
      },
    }),
  );
}

function buildEstimatedFund(
  source,
  holdings,
  mode,
  sourceName,
  market,
  dataMeta,
) {
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
    reportDate: buildFundReportDate(mode, dataMeta),
    dataFetchedAt: beijingNow(),
    dataSourceSummary: buildDataSourceSummary(mode, dataMeta, market),
    holdings,
    latestEstimate: {
      tradeDate: market.tradeDate,
      beijingTime: market.estimateAt,
      holdingCount: holdings.length,
      holdingWeightPct: sum(holdings.map((h) => h.weightPct)),
      availableHoldingCount: available.length,
      availableWeightPct: knownWeightPct,
      stockStyleReturnPct,
      fxPct,
      rawEstimatePct,
      tunedEstimatePct,
      marketDataAt: market.fetchedAt,
      quoteDataAt: dataMeta && dataMeta.quotes && dataMeta.quotes.fetchedAt,
      holdingDataAt:
        dataMeta && dataMeta.holdings && dataMeta.holdings.fetchedAt,
      holdingReportDate:
        dataMeta && dataMeta.holdings && dataMeta.holdings.reportDate,
      holdingSourceUrl: dataMeta && dataMeta.holdings && dataMeta.holdings.url,
      quoteSourceUrl: dataMeta && dataMeta.quotes && dataMeta.quotes.source,
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

function buildDataSourceSummary(mode, dataMeta, market) {
  const holdings = (dataMeta && dataMeta.holdings) || {};
  const latestTop10 = (dataMeta && dataMeta.latestTop10) || {};
  const quotes = (dataMeta && dataMeta.quotes) || {};
  const navHistory = (dataMeta && dataMeta.navHistory) || {};
  return {
    mode,
    market: {
      source: market.source,
      fetchedAt: market.fetchedAt,
      dataTime: market.updatedAt,
    },
    quotes: {
      source: quotes.source || "东方财富 push2 ulist.np/get",
      fetchedAt: quotes.fetchedAt,
      secidCount: quotes.secidCount,
      returnedCount: quotes.returnedCount,
    },
    holdings: {
      source: holdings.source || "东方财富 fundf10 FundArchivesDatas.aspx",
      url: holdings.url,
      reportDate: holdings.reportDate,
      reportTitle: holdings.reportTitle,
      fetchedAt: holdings.fetchedAt,
      rowCount: holdings.rowCount,
    },
    latestTop10:
      mode === "algorithm1"
        ? {
            source:
              latestTop10.source || "东方财富 fundf10 FundArchivesDatas.aspx",
            url: latestTop10.url,
            reportDate: latestTop10.reportDate,
            reportTitle: latestTop10.reportTitle,
            fetchedAt: latestTop10.fetchedAt,
            rowCount: latestTop10.rowCount,
          }
        : undefined,
    navHistory: {
      source: navHistory.source,
      fetchedAt: navHistory.fetchedAt,
      latestNavDate: navHistory.latestNavDate,
      rowCount: navHistory.rows ? navHistory.rows.length : undefined,
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

function buildDynamicBacktestRows(source, holdings, navHistory, returnMaps) {
  const navRows = (navHistory && navHistory.rows) || [];
  const fxMap = returnMaps.get(MARKET_SECIDS.usdcnh) || new Map();
  const equityLikePct = Number(
    (source.assetAllocation &&
      (source.assetAllocation.equityLikePct ||
        source.assetAllocation.stockPct)) ||
      0,
  );
  const rawRows = navRows
    .map((navRow) => {
      const date = navRow.navDate;
      const available = holdings
        .map((holding) => {
          const map = returnMaps.get(holding.secid);
          const returnPct = map && map.get(date);
          return typeof returnPct === "number" && Number.isFinite(returnPct)
            ? { ...holding, returnPct }
            : null;
        })
        .filter(Boolean);
      const knownWeightPct = sum(available.map((h) => h.weightPct));
      if (!knownWeightPct) return null;
      const knownContributionPct = sum(
        available.map((h) => (h.weightPct * h.returnPct) / 100),
      );
      const stockStyleReturnPct =
        (knownContributionPct / knownWeightPct) * 100;
      const fxPct = fxMap.get(date) || 0;
      const rawEstimatePct =
        stockStyleReturnPct * (equityLikePct / 100) + fxPct;
      return {
        navDate: date,
        actualPct: navRow.actualPct,
        nav: navRow.nav,
        accumulatedNav: navRow.accumulatedNav,
        stockStyleReturnPct,
        fxPct,
        rawEstimatePct,
        topWeightPct: knownWeightPct,
        missing: holdings
          .filter((holding) => {
            const map = returnMaps.get(holding.secid);
            return !(map && typeof map.get(date) === "number");
          })
          .map((holding) => holding.secid),
      };
    })
    .filter(Boolean);
  const calibration = fitCalibration(rawRows);
  const rows = rawRows.map((row) => ({
    ...row,
    tunedEstimatePct: calibration.alpha + calibration.beta * row.rawEstimatePct,
  }));
  return { rows, calibration };
}

function fitCalibration(rows) {
  const sample = rows.filter(
    (row) =>
      typeof row.actualPct === "number" &&
      typeof row.rawEstimatePct === "number",
  );
  if (sample.length < 3) return { alpha: 0, beta: 1 };
  const rawMean = sum(sample.map((row) => row.rawEstimatePct)) / sample.length;
  const actualMean = sum(sample.map((row) => row.actualPct)) / sample.length;
  const variance = sum(
    sample.map((row) => (row.rawEstimatePct - rawMean) ** 2),
  );
  if (!variance) return { alpha: 0, beta: 1 };
  const covariance = sum(
    sample.map(
      (row) =>
        (row.rawEstimatePct - rawMean) * (row.actualPct - actualMean),
    ),
  );
  const beta = covariance / variance;
  const alpha = actualMean - beta * rawMean;
  return Number.isFinite(alpha) && Number.isFinite(beta)
    ? { alpha, beta }
    : { alpha: 0, beta: 1 };
}

async function fetchHistoricalReturnMaps(secids, navRows) {
  const dates = unique((navRows || []).map((row) => row.navDate)).sort();
  const result = new Map();
  if (!dates.length) {
    return {
      returns: result,
      meta: {
        source: "东方财富 push2his stock/kline/get",
        fetchedAt: beijingNow(),
        secidCount: 0,
        returnedCount: 0,
      },
    };
  }
  const begin = compactDate(dates[0]);
  const end = compactDate(dates[dates.length - 1]);
  const list = unique(secids);
  let returnedCount = 0;
  await runLimited(list, 8, async (secid) => {
    const map = await fetchKlineReturns(secid, begin, end);
    if (map.size) {
      result.set(secid, map);
      returnedCount += 1;
    }
  });
  return {
    returns: result,
    meta: {
      source: "东方财富 push2his stock/kline/get",
      fetchedAt: beijingNow(),
      secidCount: list.length,
      returnedCount,
      begin: dates[0],
      end: dates[dates.length - 1],
    },
  };
}

async function fetchKlineReturns(secid, begin, end) {
  const url =
    "https://push2his.eastmoney.com/api/qt/stock/kline/get?fields1=f1,f2,f3,f4,f5,f6" +
    "&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61" +
    "&klt=101&fqt=1&secid=" +
    encodeURIComponent(secid) +
    "&beg=" +
    begin +
    "&end=" +
    end;
  const json = JSON.parse(
    await httpsGetText(url, "https://quote.eastmoney.com/", "utf-8"),
  );
  const klines = (json.data && json.data.klines) || [];
  const map = new Map();
  for (const line of klines) {
    const parts = String(line).split(",");
    const date = parts[0];
    const pct = Number(parts[8]);
    if (date && Number.isFinite(pct)) map.set(date, pct);
  }
  return map;
}

async function runLimited(values, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (index < values.length) {
      const current = values[index];
      index += 1;
      await worker(current);
    }
  });
  await Promise.all(workers);
}

function compactDate(value) {
  return String(value || "").replace(/-/g, "");
}

function buildHybridHoldings(fullHoldings, latestTop10) {
  const replaced = new Set(latestTop10.map((h) => h.secid));
  return [
    ...latestTop10.map((h) => ({ ...h, source: "latest-top10" })),
    ...fullHoldings
      .filter((h) => !replaced.has(h.secid))
      .map((h) => ({ ...h, source: "full-report" })),
  ]
    .sort((a, b) => b.weightPct - a.weightPct)
    .map((h, i) => ({ ...h, rank: i + 1 }));
}

async function fetchLatestFullHoldings(code) {
  const candidates = buildReportCandidates();
  let fallback = null;
  for (const params of candidates) {
    const result = await fetchFundHoldings(code, {
      topline: 1000,
      year: params.year,
      month: params.month,
    });
    if (!fallback && result.holdings.length > 0) {
      fallback = result;
    }
    if (result.holdings.length >= MIN_FULL_HOLDING_COUNT) {
      return result;
    }
    await sleep(220);
  }
  if (fallback) return fallback;
  throw new Error("no full holdings found for fund " + code);
}

function buildReportCandidates() {
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  const reportMonths = [12, 9, 6, 3];
  const candidates = [];
  for (let year = currentYear; year >= currentYear - 3; year -= 1) {
    for (const month of reportMonths) {
      if (year === currentYear && month > currentMonth) continue;
      candidates.push({ year: String(year), month: String(month) });
    }
  }
  return candidates;
}

function buildFundReportDate(mode, dataMeta) {
  const holdings = (dataMeta && dataMeta.holdings) || {};
  const latestTop10 = (dataMeta && dataMeta.latestTop10) || {};
  if (mode === "algorithm3") return holdings.reportDate || "";
  return [holdings.reportDate, latestTop10.reportDate && "top10 " + latestTop10.reportDate]
    .filter(Boolean)
    .join(" + ");
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
    "utf-8",
  );
  const tableHtml = firstBoxTable(text);
  const holdings = parseHoldingRows(tableHtml).map((holding) => ({
    ...holding,
    dataSource: "东方财富 fundf10",
    dataFetchedAt: beijingNow(),
  }));
  return {
    holdings,
    meta: {
      source: "东方财富 fundf10 FundArchivesDatas.aspx",
      url,
      fetchedAt: beijingNow(),
      reportDate: extractReportDate(text),
      reportTitle: extractReportTitle(text),
      rowCount: holdings.length,
      requestedTopline: params.topline,
    },
  };
}

async function fetchQuoteReturns(secids) {
  const result = new Map();
  let returnedCount = 0;
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
    returnedCount += rows.length;
    for (const row of rows) {
      const value = Number(row.f3);
      const code = String(row.f12 || "");
      const secid = group.find((item) => item.endsWith("." + code));
      if (secid && Number.isFinite(value) && value > -90)
        result.set(secid, value);
    }
    await sleep(180);
  }
  return {
    returns: result,
    meta: {
      source: "东方财富 push2 ulist.np/get fields=f3,f12,f14",
      fetchedAt: beijingNow(),
      secidCount: secids.length,
      returnedCount,
    },
  };
}

async function fetchFundNavHistory(code, pageSize) {
  const url =
    "https://api.fund.eastmoney.com/f10/lsjz?fundCode=" +
    encodeURIComponent(code) +
    "&pageIndex=1&pageSize=" +
    encodeURIComponent(String(pageSize)) +
    "&startDate=&endDate=&_=" +
    Date.now();
  const json = JSON.parse(
    await httpsGetText(
      url,
      "https://fundf10.eastmoney.com/jjjz_" + code + ".html",
      "utf-8",
    ),
  );
  const rows = ((json.Data && json.Data.LSJZList) || [])
    .map((row) => ({
      navDate: row.FSRQ,
      actualPct: Number(row.JZZZL),
      nav: Number(row.DWJZ),
      accumulatedNav: Number(row.LJJZ),
    }))
    .filter((row) => row.navDate && Number.isFinite(row.actualPct));
  return {
    source: "东方财富 api.fund.eastmoney.com/f10/lsjz",
    url,
    fetchedAt: beijingNow(),
    latestNavDate: rows[0] ? rows[0].navDate : "",
    rows,
  };
}

function mergeActualNavRows(fund, navRows) {
  const existingByDate = new Map(
    (fund.rows || []).map((row) => [row.navDate, row]),
  );
  const merged = [];
  for (const navRow of navRows) {
    const existing = existingByDate.get(navRow.navDate) || {};
    merged.push({
      ...existing,
      navDate: navRow.navDate,
      actualPct: navRow.actualPct,
      nav: navRow.nav,
      accumulatedNav: navRow.accumulatedNav,
    });
  }
  fund.rows = merged;
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

function extractReportDate(text) {
  const match = text.match(/截止至：<font class='px12'>([^<]+)<\/font>/);
  return match ? stripHtml(match[1]) : "";
}

function extractReportTitle(text) {
  const match = text.match(
    /<h4 class='t'><label class='left'>([\s\S]*?)<\/label>/,
  );
  return match ? stripHtml(match[1]) : "";
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
    "https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13,f14,f124&secids=" +
    secids.join(",");
  const pctBySecid = new Map();
  const timeBySecid = new Map();
  try {
    const json = JSON.parse(
      await httpsGetText(url, "https://quote.eastmoney.com/", "utf-8"),
    );
    const rows = Array.isArray(json.data && json.data.diff)
      ? json.data.diff
      : [];
    for (const row of rows) {
      const secid = row.f13 + "." + row.f12;
      pctBySecid.set(secid, Number(row.f3));
      const timestamp = Number(row.f124);
      if (Number.isFinite(timestamp) && timestamp > 0) {
        timeBySecid.set(secid, timestamp);
      }
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
  const estimateTimestamp =
    timeBySecid.get(MARKET_SECIDS.nasdaq) ||
    timeBySecid.get(MARKET_SECIDS.nasdaq100) ||
    timeBySecid.get(MARKET_SECIDS.sp500);
  const estimateAt = estimateTimestamp
    ? formatBeijingTimestamp(estimateTimestamp)
    : updatedAt;
  return {
    updatedAt: estimateAt,
    fetchedAt: updatedAt,
    estimateAt,
    tradeDate: estimateAt.slice(0, 10),
    source: "东方财富 push2 ulist.np/get fields=f2,f3,f12,f13,f14",
    fxPct,
    items: [
      { label: "纳斯达克指数", value: fmt(MARKET_SECIDS.nasdaq) },
      { label: "纳斯达克100指数", value: fmt(MARKET_SECIDS.nasdaq100) },
      { label: "标普500指数", value: fmt(MARKET_SECIDS.sp500) },
      { label: "美元人民币汇率", value: fmt(MARKET_SECIDS.usdcnh) },
      { label: "估值时间", value: estimateAt },
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

function formatBeijingTimestamp(seconds) {
  const date = new Date(seconds * 1000 + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear() +
    "-" +
    p(date.getUTCMonth() + 1) +
    "-" +
    p(date.getUTCDate()) +
    " " +
    p(date.getUTCHours()) +
    ":" +
    p(date.getUTCMinutes())
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 东财接口偶发 socket hang up / 限流，带指数退避重试
async function httpsGetText(url, referer, charset) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_RETRY_LIMIT; attempt += 1) {
    try {
      return await httpsGetTextOnce(url, referer, charset);
    } catch (error) {
      lastError = error;
      const message = error && error.message ? error.message : String(error);
      const retryable =
        /socket hang up|ECONNRESET|ETIMEDOUT|timeout|EAI_AGAIN|ENOTFOUND/i.test(
          message,
        );
      if (!retryable || attempt === REQUEST_RETRY_LIMIT) {
        break;
      }
      const backoff = Math.min(12000, 500 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 350);
      await sleep(backoff + jitter);
    }
  }
  const detail =
    lastError && lastError.message ? lastError.message : String(lastError);
  throw new Error("request failed after retries: " + detail + " | " + url);
}

function httpsGetTextOnce(url, referer, charset) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      callback();
    };
    const hardTimeout = setTimeout(() => {
      finish(() => reject(new Error("request hard timeout: " + url)));
    }, REQUEST_TIMEOUT_MS + 5000);
    const req = https.get(
      url,
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "zh-CN,zh;q=0.9",
          Connection: "close",
          Referer: referer,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          res.resume();
          finish(() =>
            reject(new Error("request failed " + res.statusCode + ": " + url)),
          );
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          try {
            // 东财基金档案页为 GBK 编码，行情接口为 UTF-8，需按 charset 解码避免中文乱码
            const decoder = new TextDecoder(charset || "utf-8");
            finish(() => resolve(decoder.decode(Buffer.concat(chunks))));
          } catch (error) {
            finish(() => reject(error));
          }
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS);
    req.on("timeout", () => req.destroy(new Error("request timeout: " + url)));
    req.on("error", (error) => finish(() => reject(error)));
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
