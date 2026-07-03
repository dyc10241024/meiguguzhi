(function () {
  const vscode = acquireVsCodeApi();
  const TEXT = {
    loading: '\u6b63\u5728\u8bfb\u53d6\u7ebf\u4e0a\u6570\u636e',
    noData: '\u6682\u65e0\u6570\u636e',
    latest: '\u6700\u65b0\u4f30\u503c',
    dataTime: '\u6570\u636e\u83b7\u53d6\u65f6\u95f4',
    estimateTime: '\u4f30\u503c\u65f6\u95f4',
    detail: '\u8be6\u60c5',
    history: '\u5386\u53f2\u56de\u6d4b',
    algorithm1: '\u7b97\u6cd51 \u5168\u91cf\u6301\u4ed3\u4f30\u503c',
    algorithm3: '\u7b97\u6cd53 \u5feb\u901f\u4f30\u503c',
    algorithm1Desc: '\u7528 2025Q4 \u5168\u91cf\u5e95\u4ed3 + 2026Q1 \u6700\u65b0\u5341\u5927\u66ff\u6362\u540e\u91cd\u6392\u4f30\u7b97',
    algorithm3Desc: '\u62c9\u53d6 2026Q1 \u6700\u65b0\u5341\u5927\u6301\u4ed3\u5f52\u4e00\u5316 + \u80a1\u7968\u7c7b\u5360\u6bd4 + \u6c47\u7387 + \u5386\u53f2\u6821\u51c6',
    alphaBetaHelp: 'alpha/beta \u662f\u5386\u53f2\u6821\u51c6\u53c2\u6570\uff1a\u7528\u8fc7\u53bb\u6570\u636e\u62df\u5408 actual = alpha + beta * raw\u3002',
    maeHelp: 'MAE \u662f\u5e73\u5747\u7edd\u5bf9\u8bef\u5dee\uff0cRMSE \u5bf9\u5927\u8bef\u5dee\u66f4\u654f\u611f\u3002'
  };

  let state = { mode: 'algorithm3', modes: { algorithm1: [], algorithm3: [] }, market: null };

  const $ = (id) => document.getElementById(id);
  const subtitle = $('subtitle');
  const fundList = $('fundList');
  const refreshButton = $('refreshButton');
  const marketBar = $('marketBar');
  const modalBackdrop = $('modalBackdrop');
  const modalTitle = $('modalTitle');
  const modalMeta = $('modalMeta');
  const modalBody = $('modalBody');
  const modalClose = $('modalClose');

  refreshButton?.addEventListener('click', () => {
    setStatus(TEXT.loading);
    vscode.postMessage({ type: 'refresh' });
  });
  modalClose?.addEventListener('click', closeModal);
  modalBackdrop?.addEventListener('click', (event) => {
    if (event.target === modalBackdrop) closeModal();
  });

  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.mode = button.dataset.mode;
      render();
    });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'error') {
      setStatus(message.payload.message || '\u8bfb\u53d6\u5931\u8d25');
      return;
    }
    if (message.type !== 'data') return;

    state.modes = message.payload.modes || state.modes;
    state.market = message.payload.market || null;
    subtitle.textContent = '\u66f4\u65b0\u4e8e ' + (state.market?.updatedAt || '--');
    render();
  });

  setStatus(TEXT.loading);
  vscode.postMessage({ type: 'ready' });

  function render() {
    renderTabs();
    renderMarket();
    renderFunds();
  }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === state.mode);
    });
  }

  function renderMarket() {
    const items = state.market?.items || [];
    marketBar.innerHTML = items.map((item) => '<div class="market-item"><span>' + escapeHtml(item.label) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>').join('');
  }

  function renderFunds() {
    const funds = state.modes[state.mode] || [];
    if (!funds.length) {
      setStatus(TEXT.noData);
      return;
    }

    fundList.innerHTML = '';
    for (const fund of funds) {
      const latest = fund.latestEstimate || {};
      const card = document.createElement('article');
      card.className = 'fund-card';
      card.innerHTML =
        '<div class="fund-title-row">' +
          '<div class="fund-title-main"><span class="fund-name">' + escapeHtml(fund.name) + '</span></div>' +
          '<span class="fund-code">' + escapeHtml(fund.code) + '</span>' +
        '</div>' +
        '<div class="list-row">' +
          '<div><span>' + TEXT.latest + '</span><strong class="' + tone(latest.tunedEstimatePct) + '">' + formatPct(latest.tunedEstimatePct) + '</strong></div>' +
          '<div><span>' + TEXT.estimateTime + '</span><strong>' + escapeHtml(latest.beijingTime || '--') + '</strong></div>' +
          '<div><span>' + TEXT.dataTime + '</span><strong>' + escapeHtml(shortTime(fund.dataFetchedAt)) + '</strong></div>' +
          '<div class="card-actions"><button class="small-button detail" type="button">' + TEXT.detail + '</button><button class="small-button history" type="button">' + TEXT.history + '</button></div>' +
        '</div>';
      card.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        showDetail(fund);
      });
      card.querySelector('.detail').addEventListener('click', () => showDetail(fund));
      card.querySelector('.history').addEventListener('click', () => showHistory(fund));
      fundList.appendChild(card);
    }
  }

  function showDetail(fund) {
    const holdings = fund.holdings || [];
    const latest = fund.latestEstimate || {};
    modalTitle.textContent = fund.name + ' ' + fund.code;
    modalMeta.textContent = (state.mode === 'algorithm1' ? TEXT.algorithm1Desc : TEXT.algorithm3Desc) + ' | ' + TEXT.dataTime + ' ' + shortTime(fund.dataFetchedAt);
    modalBody.innerHTML =
      '<div class="summary-grid">' +
        summaryItem('\u6301\u4ed3\u6570', latest.holdingCount ?? holdings.length) +
        summaryItem('\u6301\u4ed3\u5360\u6bd4', formatPct(latest.holdingWeightPct)) +
        summaryItem('\u53ef\u7528\u6743\u91cd', formatPct(latest.availableWeightPct)) +
        summaryItem('\u80a1\u7968\u7c7b\u5360\u6bd4', formatPct(fund.assetAllocation?.equityLikePct)) +
        summaryItem('\u6570\u636e\u6765\u6e90', fund.source || modeName(state.mode)) +
        summaryItem('\u62a5\u544a\u671f', fund.reportDate || fund.assetAllocation?.reportDate || '--') +
      '</div>' + holdingTable(holdings);
    openModal();
  }

  function showHistory(fund) {
    const metrics = fund.calculatedMetrics?.tuned;
    const calibration = fund.calibration || {};
    modalTitle.textContent = TEXT.history + ' ' + fund.name;
    modalMeta.innerHTML =
      'alpha=' + num(calibration.alpha) + '  beta=' + num(calibration.beta) +
      '  |  MAE ' + num(metrics?.mae) +
      '  |  RMSE ' + num(metrics?.rmse) +
      '  |  \u65b9\u5411 ' + (metrics ? metrics.directionCorrect + '/' + metrics.sampleCount : '--') +
      '  |  ' + TEXT.dataTime + ' ' + shortTime(fund.dataFetchedAt) +
      ' <button class="help-button" title="' + escapeHtml(TEXT.alphaBetaHelp + '\n' + TEXT.maeHelp) + '">?</button>';

    const rows = fund.rows || [];
    if (!rows.length) {
      modalBody.innerHTML = '<div class="empty-state">\u6682\u672a\u751f\u6210\u5386\u53f2\u56de\u6d4b\u3002</div>';
    } else {
      modalBody.innerHTML = '<div class="history-table">' + rows.slice().reverse().map((row) =>
        '<div class="history-row"><span>' + escapeHtml(row.navDate) + '</span><b class="' + tone(row.actualPct) + '">\u5b9e\u9645 ' + formatPct(row.actualPct) + '</b><b class="' + tone(row.tunedEstimatePct) + '">\u4f30\u503c ' + formatPct(row.tunedEstimatePct) + '</b><b class="' + tone(row.tunedErrorPct) + '">\u8bef\u5dee ' + formatPct(row.tunedErrorPct) + '</b></div>'
      ).join('') + '</div>';
    }
    openModal();
  }

  function holdingTable(holdings) {
    if (!holdings.length) return '<div class="empty-state">' + TEXT.noData + '</div>';
    return '<div class="holding-table">' + holdings.map((holding) =>
      '<div class="holding-row"><span>' + escapeHtml((holding.rank ? holding.rank + '. ' : '') + (holding.name || '')) + '</span><code>' + escapeHtml(holding.secid || holding.code || '') + '</code><b>' + marketName(holding.secid) + '</b><b>' + formatPct(holding.weightPct) + '</b><b class="' + tone(holding.returnPct) + '">' + formatPct(holding.returnPct) + '</b><b class="' + tone(holding.contributionPct) + '">' + formatPct(holding.contributionPct) + '</b></div>'
    ).join('') + '</div>';
  }

  function summaryItem(label, value) {
    return '<div><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }

  function setStatus(text) {
    fundList.innerHTML = '<div class="empty-state">' + escapeHtml(text) + '</div>';
  }

  function modeName(mode) { return mode === 'algorithm1' ? TEXT.algorithm1 : TEXT.algorithm3; }
  function openModal() { modalBackdrop.classList.remove('hidden'); }
  function closeModal() { modalBackdrop.classList.add('hidden'); }

  function marketName(secid) {
    if (!secid) return '--';
    const prefix = String(secid).split('.')[0];
    if (prefix === '105' || prefix === '106') return '\u7f8e\u80a1';
    if (prefix === '116') return '\u6e2f\u80a1';
    if (prefix === '0') return '\u6df1\u8bc1';
    if (prefix === '1') return '\u4e0a\u8bc1';
    return prefix;
  }

  function formatPct(value) {
    if (value === undefined || value === null || Number.isNaN(Number(value))) return '--';
    const number = Number(value);
    return (number > 0 ? '+' : '') + number.toFixed(2) + '%';
  }

  function num(value) { return value === undefined || value === null || Number.isNaN(Number(value)) ? '--' : Number(value).toFixed(3); }
  function tone(value) { const number = Number(value); if (number > 0.005) return 'positive'; if (number < -0.005) return 'negative'; return 'neutral'; }
  function shortTime(value) { return value ? String(value).slice(0, 16).replace('T', ' ') : '--'; }
  function escapeHtml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
})();