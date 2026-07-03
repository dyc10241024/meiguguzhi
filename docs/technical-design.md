# 技术方案

## 总体架构

首版采用纯本地 Cursor / VSCode 扩展，不建设后端服务和数据库。

```text
Cursor / VSCode Extension
  ├─ Extension Host
  │   ├─ commands
  │   ├─ data services
  │   ├─ valuation engine
  │   ├─ cache
  │   └─ config
  └─ Webview UI
      ├─ index cards
      ├─ fund list
      ├─ fund detail
      └─ backtest table
```

## 技术栈

推荐：

- TypeScript
- VSCode Extension API
- Webview UI
- Vite
- Vue 或 React
- 本地 JSON 配置
- 本地文件缓存

首版可以使用 Vue，因为当前用户环境里已有 Vue/Vite 项目经验。

## 为什么不需要后端

本项目是个人自用，所有数据都可以在刷新时直接从公开接口获取：

- 基金历史净值。
- 基金持仓。
- 指数行情。
- 股票日线行情。

本地只需要缓存：

- 接口响应。
- 股票历史 K 线。
- 最近一次估算结果。
- 基金级调优参数。

不需要数据库的原因：

- 数据规模很小。
- 用户只有自己。
- 刷新频率低。
- 历史净值和行情可重复拉取。

## 目录建议

```text
D:\meiguguzhi
  ├─ docs
  │   ├─ requirements.md
  │   ├─ technical-design.md
  │   ├─ data-and-algorithm.md
  │   └─ cursor-extension-plan.md
  ├─ extension
  │   ├─ package.json
  │   ├─ tsconfig.json
  │   ├─ src
  │   │   ├─ extension.ts
  │   │   ├─ config
  │   │   │   └─ funds.ts
  │   │   ├─ services
  │   │   │   ├─ eastmoney.ts
  │   │   │   ├─ yahoo.ts
  │   │   │   └─ cache.ts
  │   │   ├─ valuation
  │   │   │   ├─ engine.ts
  │   │   │   ├─ calibration.ts
  │   │   │   └─ backtest.ts
  │   │   └─ webview
  │   │       └─ panel.ts
  │   └─ media
  │       ├─ main.js
  │       └─ main.css
  └─ README.md
```

## 数据模型

### FundConfig

```ts
export interface FundConfig {
  code: string;
  name: string;
  enabled: boolean;
  calibration: {
    alpha: number;
    beta: number;
  };
}
```

### Holding

```ts
export interface Holding {
  secid: string;
  symbol: string;
  market: 'US' | 'HK' | 'CN';
  name: string;
  weight: number;
}
```

### ValuationResult

```ts
export interface ValuationResult {
  fundCode: string;
  fundName: string;
  tradeDate: string;
  rawEstimate: number;
  tunedEstimate: number;
  coveredWeight: number;
  missingCount: number;
  holdings: HoldingContribution[];
  updatedAt: string;
}
```

### HoldingContribution

```ts
export interface HoldingContribution extends Holding {
  returnPct: number | null;
  contribution: number | null;
  status: 'ok' | 'holiday' | 'missing';
}
```

### ValuationMode

```ts
export type ValuationMode =
  | 'full-holdings'
  | 'sector-compensated'
  | 'normalized-top10';
```

### HoldingsReport

```ts
export interface HoldingsReport {
  fundCode: string;
  reportType: 'annual' | 'semi-annual' | 'quarterly' | 'fund-profile';
  reportDate: string;
  disclosureDate?: string;
  isFullHoldings: boolean;
  freshness: 'fresh' | 'usable' | 'stale';
  equityWeight?: number;
  holdings: Holding[];
}
```

全量持仓判断规则：

```text
reportType = annual 或 semi-annual
并且报告内存在“所有权益投资明细”或“所有股票投资明细”
```

持仓新旧判断：

```text
fresh: 估值日 - 报告截止日 <= 90天
usable: 90天 < 估值日 - 报告截止日 <= 180天
stale: 估值日 - 报告截止日 > 180天
```

## 刷新流程

1. 读取基金配置。
2. 拉取指数行情。
3. 拉取每只基金的前十大持仓。
4. 将东方财富 secid 映射为行情 symbol。
5. 按目标日期拉取持仓股票日线。
6. 计算原始估值。
7. 套用基金级校准参数。
8. 拉取最近实际净值涨跌幅。
9. 写入本地缓存。
10. 通知 Webview 更新 UI。

## 估值模式选择

估值引擎按数据质量自动降级：

```text
if 有 fresh 全量持仓:
  使用 full-holdings
else if 有已知持仓 + 股票仓位或可估股票仓位 + 板块代理:
  使用 sector-compensated
else:
  使用 normalized-top10
```

如果全量持仓为 `usable`，不直接完全信任个股权重，可用于识别板块暴露；如果为 `stale`，只作为历史风格参考。

## 三种估值算法

内部计算统一使用小数，展示时再转为百分比。例如 `40%` 在计算中写作 `0.40`。

变量定义：

```text
r_i = 第 i 个持仓股票当日涨跌幅
w_i = 第 i 个持仓占基金资产净值比例
W_known = 已知持仓权重合计
W_equity = 权益/股票仓位
W_unknown = W_equity - W_known
R_fx = 汇率贡献
alpha, beta = 基金级历史误差校准参数
```

### full-holdings

适用条件：拿到较新的年报或半年报全量权益持仓。

```text
R_known = Σ(w_i × r_i)
W_unknown = max(W_equity - W_known, 0)
R_unknown = W_unknown × R_proxy
R_total = R_known + R_unknown + R_fx
R_final = alpha + beta × R_total
```

如果全量持仓覆盖全部权益仓位，则 `W_unknown = 0`。

### sector-compensated

适用条件：没有较新的全量持仓，但有前十大或其他已知持仓，并能从公开数据拿到行业/板块代理。

```text
R_known = Σ(w_i × r_i)
W_unknown = max(W_equity - W_known, 0)
R_sector = Σ(sector_exposure_j × sector_return_j)
R_unknown = W_unknown × R_sector
R_total = R_known + R_unknown + R_fx
R_final = alpha + beta × R_total
```

示例：

```text
W_known = 40%
W_equity = 90%
W_unknown = 50%

R_known = -1.80%

sector exposure:
半导体 60%，科技平台 25%，消费科技 15%

sector return:
SMH -5.00%，XLK -1.50%，XLY -0.80%

R_sector = 60% × -5.00% + 25% × -1.50% + 15% × -0.80%
         = -3.495%

R_unknown = 50% × -3.495%
          = -1.7475%

R_total = -1.80% + -1.7475% + R_fx
```

### normalized-top10

适用条件：只有前十大持仓，没有可靠股票仓位和板块代理。

```text
R_raw = Σ(w_i × r_i) / Σ(w_i)
R_total = R_raw + R_fx
R_final = alpha + beta × R_total
```

该模式等价于假设未披露仓位的走势接近前十大重仓股，是快速兜底方案。

## 回测流程

1. 拉取基金最近 N 个净值日。
2. 拉取所有持仓股票覆盖日期区间的日线。
3. 对每个净值日计算 rawEstimate。
4. 套用 tunedEstimate。
5. 与实际日增长率比较。
6. 输出 MAE、RMSE、Bias、方向正确率。

指标定义：

```text
error = estimate - actual
MAE = mean(abs(error))
RMSE = sqrt(mean(error^2))
Bias = mean(error)
方向正确率 = sign(estimate) == sign(actual)
```

## 缓存策略

缓存位置：

```text
context.globalStorageUri
```

建议缓存文件：

```text
cache/
  funds/{fundCode}/holdings.json
  funds/{fundCode}/nav-history.json
  quotes/{symbol}.json
  indices/latest.json
  valuation/latest.json
```

缓存 TTL：

| 数据 | TTL |
|---|---:|
| 指数实时行情 | 1 分钟 |
| 股票当日日线 | 5 分钟 |
| 基金历史净值 | 30 分钟 |
| 前十大持仓 | 1 天 |

## 错误处理

接口失败时：

- 自动重试 2 次。
- 如果有缓存，使用缓存并显示缓存时间。
- 如果没有缓存，显示该项数据不可用。

估值失败时：

- 单只基金不影响其他基金。
- Webview 展示失败原因。
- Output Channel 记录详细错误。

## 安全与合规

扩展只请求公开网页接口，不保存用户登录态，不采集个人数据。

页面展示必须避免投资建议语气，统一使用“估算”“回测”“误差”等描述。

## 后续可扩展能力

- 支持用户自定义基金列表。
- 支持自动拟合 alpha/beta。
- 支持指数残差模型。
- 支持汇率贡献。
- 支持导出 CSV。
- 支持每日估值快照本地留存。
