(function () {
  const vscode = acquireVsCodeApi();
  const TEXT = {
    loading: "\u6b63\u5728\u8bfb\u53d6\u771f\u5b9e\u63a5\u53e3\u6570\u636e",
    noData: "\u6682\u65e0\u6570\u636e",
    latest: "\u6700\u65b0\u4f30\u503c",
    dataTime: "\u6570\u636e\u83b7\u53d6\u65f6\u95f4",
    source: "\u6570\u636e\u6765\u6e90",
    quoteTime: "\u884c\u60c5\u83b7\u53d6\u65f6\u95f4",
    reportDate: "\u6301\u4ed3\u62a5\u544a\u671f",
    estimateTime: "\u4f30\u503c\u65f6\u95f4",
    detail: "\u8be6\u60c5",
    history: "\u5386\u53f2\u56de\u6d4b",
    apiDebug: "\u63a5\u53e3\u8c03\u8bd5",
    algorithm1: "\u7b97\u6cd51 \u5168\u91cf\u6301\u4ed3\u4f30\u503c",
    algorithm3: "\u7b97\u6cd53 \u5feb\u901f\u4f30\u503c",
    algorithm1Desc:
      "\u7528\u6700\u65b0\u53ef\u83b7\u53d6\u7684\u5168\u91cf\u5e95\u4ed3 + \u6700\u65b0\u5341\u5927\u66ff\u6362\u540e\u91cd\u6392\u4f30\u7b97",
    algorithm3Desc:
      "\u62c9\u53d6\u6700\u65b0\u5b63\u5ea6\u524d\u5341\u5927\u6301\u4ed3\u5f52\u4e00\u5316 + \u80a1\u7968\u7c7b\u5360\u6bd4 + \u6c47\u7387 + \u5386\u53f2\u6821\u51c6",
    alphaBetaHelp:
      "alpha/beta \u662f\u5386\u53f2\u6821\u51c6\u53c2\u6570\uff1a\u7528\u8fc7\u53bb\u6570\u636e\u62df\u5408 actual = alpha + beta * raw\u3002",
    maeHelp:
      "MAE \u662f\u5e73\u5747\u7edd\u5bf9\u8bef\u5dee\uff0cRMSE \u5bf9\u5927\u8bef\u5dee\u66f4\u654f\u611f\u3002",
  };

  let state = {
    mode: "algorithm3",
    modes: { algorithm1: [], algorithm3: [] },
    market: null,
  };

  const $ = (id) => document.getElementById(id);
  const subtitle = $("subtitle");
  const fundList = $("fundList");
  const refreshButton = $("refreshButton");
  const debugButton = $("debugButton");
  const marketBar = $("marketBar");
  const modalBackdrop = $("modalBackdrop");
  const modalTitle = $("modalTitle");
  const modalMeta = $("modalMeta");
  const modalBody = $("modalBody");
  const modalClose = $("modalClose");

  refreshButton?.addEventListener("click", () => {
    console.log("refresh button clicked");
    setStatus(TEXT.loading);
    vscode.postMessage({ type: "refresh" });
  });
  debugButton?.addEventListener("click", showDebug);
  modalClose?.addEventListener("click", closeModal);
  modalBackdrop?.addEventListener("click", (event) => {
    if (event.target === modalBackdrop) closeModal();
  });

  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      render();
    });
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    console.log("received message:", message.type);
    if (message.type === "error") {
      setStatus(message.payload.message || "\u8bfb\u53d6\u5931\u8d25");
      return;
    }
    if (message.type === "debugResult") {
      renderDebugResult(message.payload);
      return;
    }
    if (message.type !== "data") return;

    console.log("received data, updating state");
    state.modes = message.payload.modes || state.modes;
    state.market = message.payload.market || null;
    subtitle.textContent =
      "\u771f\u5b9e\u63a5\u53e3\u6570\u636e | \u6307\u6807\u6570\u636e\u65f6\u95f4 " +
      (state.market?.updatedAt || "--");
    render();
  });

  setStatus(TEXT.loading);
  vscode.postMessage({ type: "ready" });

  function render() {
    renderTabs();
    renderMarket();
    renderFunds();
  }

  function renderTabs() {
    document.querySelectorAll(".tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === state.mode);
    });
  }

  function renderMarket() {
    const items = state.market?.items || [];
    marketBar.innerHTML = items
      .map((item) => {
        const value = item.value || "";
        const valueClass = tone(value);
        return (
          '<div class="market-item"><span>' +
          escapeHtml(item.label) +
          '</span><strong class="' +
          valueClass +
          '">' +
          escapeHtml(value) +
          "</strong></div>"
        );
      })
      .join("");
  }

  function renderFunds() {
    const funds = state.modes[state.mode] || [];
    if (!funds.length) {
      setStatus(TEXT.noData);
      return;
    }

    fundList.innerHTML = "";
    for (const fund of funds) {
      const latest = fund.latestEstimate || {};
      const card = document.createElement("article");
      card.className = "fund-card";
      card.innerHTML =
        '<div class="fund-title-row">' +
        '<div class="fund-title-main"><span class="fund-name">' +
        escapeHtml(fund.name) +
        "</span></div>" +
        '<span class="fund-code">' +
        escapeHtml(fund.code) +
        "</span>" +
        "</div>" +
        '<div class="list-row">' +
        "<div><span>" +
        TEXT.latest +
        '</span><strong class="' +
        tone(latest.tunedEstimatePct) +
        '">' +
        formatPct(latest.tunedEstimatePct) +
        "</strong></div>" +
        "<div><span>" +
        TEXT.estimateTime +
        "</span><strong>" +
        escapeHtml(latest.beijingTime || "--") +
        "</strong></div>" +
        '<div class="list-meta"><small>' +
        TEXT.dataTime +
        " " +
        escapeHtml(shortTime(fund.dataFetchedAt)) +
        "</small><small>" +
        TEXT.reportDate +
        " " +
        escapeHtml(
          latest.holdingReportDate ||
            fund.dataSourceSummary?.holdings?.reportDate ||
            fund.reportDate ||
            "--",
        ) +
        "</small></div>" +
        '<div class="card-actions"><button class="small-button detail" type="button">' +
        TEXT.detail +
        '</button><button class="small-button history" type="button">' +
        TEXT.history +
        "</button></div>" +
        "</div>";
      card.addEventListener("dblclick", (event) => {
        if (event.target.closest("button")) return;
        showDetail(fund);
      });
      card
        .querySelector(".detail")
        .addEventListener("click", () => showDetail(fund));
      card
        .querySelector(".history")
        .addEventListener("click", () => showHistory(fund));
      fundList.appendChild(card);
    }
  }

  function showDebug() {
    modalTitle.textContent = TEXT.apiDebug;
    modalMeta.textContent =
      "\u9636\u6bb52\uff1a\u70b9\u51fb\u6309\u94ae\u7531 Extension Host \u8bf7\u6c42\u4e09\u65b9\u63a5\u53e3\uff0c\u8fd4\u56de JSON \u6216\u539f\u59cb\u54cd\u5e94\u6458\u8981\u3002";
    modalBody.innerHTML =
      '<div class="debug-actions">' +
      debugButtonHtml("market", "\u9876\u90e8\u6307\u6807") +
      debugButtonHtml("quotes", "\u91cd\u4ed3\u80a1\u7968\u884c\u60c5") +
      debugButtonHtml("fundTop10", "270023 \u6700\u65b0\u5341\u5927") +
      debugButtonHtml("fundFull", "270023 \u5168\u91cf\u6301\u4ed3") +
      "</div>" +
      '<pre id="debugOutput" class="json-output">\u9009\u62e9\u4e00\u4e2a\u63a5\u53e3\u5f00\u59cb\u8c03\u8bd5\u3002</pre>';

    modalBody.querySelectorAll(".debug-api").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.key;
        const output = $("debugOutput");
        if (output) {
          output.textContent = "\u8bf7\u6c42\u4e2d...";
        }
        vscode.postMessage({ type: "debugApi", key });
      });
    });
    openModal();
  }

  function renderDebugResult(payload) {
    let output = $("debugOutput");
    if (!output) {
      showDebug();
      output = $("debugOutput");
    }
    if (!output) return;
    output.textContent = JSON.stringify(payload, null, 2);
  }

  function debugButtonHtml(key, label) {
    return (
      '<button type="button" class="small-button debug-api" data-key="' +
      escapeHtml(key) +
      '">' +
      escapeHtml(label) +
      "</button>"
    );
  }

  function showDetail(fund) {
    const holdings = fund.holdings || [];
    const latest = fund.latestEstimate || {};
    modalTitle.textContent = fund.name + " " + fund.code;
    modalMeta.textContent =
      (state.mode === "algorithm1"
        ? TEXT.algorithm1Desc
        : TEXT.algorithm3Desc) +
      " | " +
      TEXT.dataTime +
      " " +
      shortTime(fund.dataFetchedAt);
    modalBody.innerHTML =
      '<div class="summary-grid">' +
      summaryItem(
        "\u6301\u4ed3\u6570",
        latest.holdingCount ?? holdings.length,
      ) +
      summaryItem(
        "\u6301\u4ed3\u5360\u6bd4",
        formatPct(latest.holdingWeightPct),
      ) +
      summaryItem(
        "\u53ef\u7528\u6743\u91cd",
        formatPct(latest.availableWeightPct),
      ) +
      summaryItem(
        "\u80a1\u7968\u7c7b\u5360\u6bd4",
        formatPct(fund.assetAllocation?.equityLikePct),
      ) +
      summaryItem(
        "\u6570\u636e\u6765\u6e90",
        fund.dataSourceSummary?.holdings?.source ||
          fund.source ||
          modeName(state.mode),
      ) +
      summaryItem(
        "\u884c\u60c5\u6765\u6e90",
        fund.dataSourceSummary?.quotes?.source || "--",
      ) +
      summaryItem(
        "\u62a5\u544a\u671f",
        fund.dataSourceSummary?.holdings?.reportDate ||
          fund.reportDate ||
          fund.assetAllocation?.reportDate ||
          "--",
      ) +
      summaryItem(
        "\u6301\u4ed3\u83b7\u53d6\u65f6\u95f4",
        shortTime(fund.dataSourceSummary?.holdings?.fetchedAt),
      ) +
      summaryItem(
        "\u884c\u60c5\u83b7\u53d6\u65f6\u95f4",
        shortTime(fund.dataSourceSummary?.quotes?.fetchedAt),
      ) +
      summaryItem(
        "\u6307\u6807\u6570\u636e\u65f6\u95f4",
        fund.dataSourceSummary?.market?.dataTime || "--",
      ) +
      "</div>" +
      holdingTable(holdings);
    openModal();
  }

  function showHistory(fund) {
    const metrics = fund.calculatedMetrics?.tuned;
    const calibration = fund.calibration || {};
    modalTitle.textContent = TEXT.history + " " + fund.name;
    modalMeta.innerHTML =
      "alpha=" +
      num(calibration.alpha) +
      "  beta=" +
      num(calibration.beta) +
      "  |  MAE " +
      num(metrics?.mae) +
      "  |  RMSE " +
      num(metrics?.rmse) +
      "  |  \u65b9\u5411 " +
      (metrics ? metrics.directionCorrect + "/" + metrics.sampleCount : "--") +
      "  |  " +
      TEXT.dataTime +
      " " +
      shortTime(fund.dataFetchedAt) +
      ' <button class="help-button" title="' +
      escapeHtml(TEXT.alphaBetaHelp + "\n" + TEXT.maeHelp) +
      '">?</button>';

    const rows = fund.rows || [];
    if (!rows.length) {
      modalBody.innerHTML =
        '<div class="empty-state">\u6682\u672a\u751f\u6210\u5386\u53f2\u56de\u6d4b\u3002</div>';
    } else {
      modalBody.innerHTML =
        '<div class="history-table">' +
        rows
          .slice()
          .sort((a, b) => String(b.navDate).localeCompare(String(a.navDate)))
          .map(
            (row) =>
              '<div class="history-row"><span>' +
              escapeHtml(row.navDate) +
              '</span><b class="' +
              tone(row.actualPct) +
              '">\u5b9e\u9645 ' +
              formatPct(row.actualPct) +
              '</b><b class="' +
              tone(row.tunedEstimatePct) +
              '">\u4f30\u503c ' +
              formatPct(row.tunedEstimatePct) +
              '</b><b class="' +
              tone(row.tunedErrorPct) +
              '">\u8bef\u5dee ' +
              formatPct(row.tunedErrorPct) +
              "</b></div>",
          )
          .join("") +
        "</div>";
    }
    openModal();
  }

  function holdingTable(holdings) {
    if (!holdings.length)
      return '<div class="empty-state">' + TEXT.noData + "</div>";
    const header =
      '<div class="holding-row"><span>持仓</span><code>代码</code><b class="market-name">市场</b><b class="weight-pct">占比</b><b>涨跌幅</b><b>贡献值</b><b>来源</b><b>获取时间</b></div>';
    return (
      '<div class="holding-table">' +
      header +
      holdings
        .map(
          (holding) =>
            '<div class="holding-row"><span>' +
            escapeHtml(
              (holding.rank ? holding.rank + ". " : "") + (holding.name || ""),
            ) +
            "</span><code>" +
            escapeHtml(holding.secid || holding.code || "") +
            '</code><b class="market-name">' +
            marketName(holding.secid) +
            '</b><b class="weight-pct">' +
            formatPctNoSign(holding.weightPct) +
            '</b><b class="' +
            tone(holding.returnPct) +
            '">' +
            formatPct(holding.returnPct) +
            '</b><b class="' +
            tone(holding.contributionPct) +
            '">' +
            formatPct6(holding.contributionPct) +
            "</b><b>" +
            escapeHtml(holding.source || holding.dataSource || "--") +
            "</b><b>" +
            escapeHtml(shortTime(holding.dataFetchedAt)) +
            "</b></div>",
        )
        .join("") +
      "</div>"
    );
  }

  function summaryItem(label, value) {
    return (
      "<div><span>" +
      escapeHtml(label) +
      "</span><strong>" +
      escapeHtml(value) +
      "</strong></div>"
    );
  }

  function setStatus(text) {
    fundList.innerHTML =
      '<div class="empty-state">' + escapeHtml(text) + "</div>";
  }

  function modeName(mode) {
    return mode === "algorithm1" ? TEXT.algorithm1 : TEXT.algorithm3;
  }
  function openModal() {
    modalBackdrop.classList.remove("hidden");
  }
  function closeModal() {
    modalBackdrop.classList.add("hidden");
  }

  function marketName(secid) {
    if (!secid) return "--";
    const prefix = String(secid).split(".")[0];
    if (prefix === "105" || prefix === "106") return "\u7f8e\u80a1";
    if (prefix === "116") return "\u6e2f\u80a1";
    if (prefix === "0") return "\u6df1\u8bc1";
    if (prefix === "1") return "\u4e0a\u8bc1";
    return prefix;
  }

  function formatPct(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value)))
      return "--";
    const number = Number(value);
    return (number > 0 ? "+" : "") + number.toFixed(2) + "%";
  }

  function formatPct6(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value)))
      return "--";
    const number = Number(value);
    return (number > 0 ? "+" : "") + number.toFixed(6) + "%";
  }

  function formatPctNoSign(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value)))
      return "--";
    return Number(value).toFixed(2) + "%";
  }

  function num(value) {
    return value === undefined || value === null || Number.isNaN(Number(value))
      ? "--"
      : Number(value).toFixed(3);
  }
  function tone(value) {
    if (typeof value === "string") {
      const match = value.match(/([+-]?\d+\.?\d*)%/);
      if (match) {
        const number = Number(match[1]);
        if (number > 0.005) return "positive";
        if (number < -0.005) return "negative";
      }
      return "neutral";
    }
    const number = Number(value);
    if (number > 0.005) return "positive";
    if (number < -0.005) return "negative";
    return "neutral";
  }
  function shortTime(value) {
    return value ? String(value).slice(0, 16).replace("T", " ") : "--";
  }
  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
})();
