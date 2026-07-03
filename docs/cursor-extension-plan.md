# Cursor 扩展实现计划

## 目标

实现一个可在 Cursor 中本地安装使用的 VSCode 扩展。

首版不发布 Marketplace，只通过本地开发模式或 `.vsix` 安装。

## 扩展功能

### Commands

建议注册命令：

| 命令 | 说明 |
|---|---|
| `meiguguzhi.open` | 打开估值侧边栏 |
| `meiguguzhi.refresh` | 刷新当前估值 |
| `meiguguzhi.backtest` | 回测最近 20 个净值日 |
| `meiguguzhi.clearCache` | 清理本地缓存 |

### Views

侧边栏 View：

```json
{
  "id": "meiguguzhi.view",
  "name": "美股估值"
}
```

### Configuration

用户可在设置中配置：

```json
{
  "meiguguzhi.funds": ["270023", "501226", "017436"],
  "meiguguzhi.backtestDays": 20,
  "meiguguzhi.autoRefresh": false,
  "meiguguzhi.refreshIntervalMinutes": 5
}
```

首版也可以先写死默认基金列表，再逐步开放配置。

## UI 设计

### 顶部指标区

四个紧凑指标：

- 纳指
- 纳指 100
- 标普 500
- 汇率

每项显示：

- 名称
- 涨跌幅
- 更新时间

### 基金列表

每行显示：

- 基金名称
- 基金代码
- 估算涨跌幅
- 最近实际涨跌幅
- 数据状态

颜色：

- 上涨：红色
- 下跌：绿色
- 缺失：灰色

说明：按国内基金产品习惯使用红涨绿跌。

### 详情面板

点击基金后显示：

- 前十大持仓表。
- 每只股票涨跌幅。
- 权重。
- 贡献值。
- 数据状态。

### 回测表

展示最近 20 个净值日：

| 日期 | 实际 | 原始估算 | 调优估算 | 误差 |
|---|---:|---:|---:|---:|

顶部显示：

- MAE
- RMSE
- Bias
- 方向正确率

## 实现阶段

### Phase 1：扩展骨架

目标：

- 初始化 VSCode Extension 项目。
- 注册侧边栏 Webview。
- 注册刷新命令。
- 展示静态基金列表。

验收：

- Cursor 能打开扩展。
- 侧边栏能显示三只基金。

### Phase 2：数据服务

目标：

- 实现东方财富历史净值抓取。
- 实现东方财富持仓抓取。
- 实现 Yahoo 日线抓取。
- 实现指数行情抓取。

验收：

- 能拉取 `270023`、`501226`、`017436` 持仓。
- 能拉取最近 20 个净值日。
- 能拉取持仓股票日线。

### Phase 3：估值引擎

目标：

- 实现 Fund_nav 归一化公式。
- 实现 alpha/beta 调优公式。
- 实现持仓贡献计算。

验收：

- 对 `2026-07-01` 净值日能得到接近历史测试结果的估算值。
- 能展示 coveredWeight 和 missingCount。

### Phase 4：回测

目标：

- 实现最近 20 个净值日回测。
- 输出 MAE、RMSE、Bias、方向正确率。

验收：

- `270023` 调优后 MAE 约 `0.77%`。
- `501226` 原公式 MAE 约 `0.77%`。
- `017436` 原公式 MAE 约 `0.78%`。

### Phase 5：体验完善

目标：

- 加缓存。
- 加错误提示。
- 加 loading 状态。
- 加手动刷新。
- 加清理缓存命令。

验收：

- 接口偶发失败时仍能用缓存展示。
- Webview 不会卡死。
- Output Channel 能看到错误细节。

## 开发命令建议

初始化扩展：

```bash
npm create @vscode/create-extension
```

推荐选择：

```text
New Extension (TypeScript)
```

本地运行：

```bash
npm install
npm run compile
```

在 Cursor / VSCode 中按 `F5` 启动 Extension Development Host。

打包 `.vsix`：

```bash
npm install -g @vscode/vsce
vsce package
```

本地安装：

```bash
code --install-extension meiguguzhi-0.0.1.vsix
```

Cursor 通常兼容 VSCode 扩展，也可以从 Cursor 的扩展面板选择本地 `.vsix` 安装。

## 首版默认基金配置

```ts
export const DEFAULT_FUNDS = [
  {
    code: '270023',
    name: '广发全球精选',
    enabled: true,
    calibration: { alpha: 0, beta: 0.88 },
  },
  {
    code: '501226',
    name: '长城全球新能源车',
    enabled: true,
    calibration: { alpha: 0, beta: 1 },
  },
  {
    code: '017436',
    name: '华宝纳斯达克精选',
    enabled: true,
    calibration: { alpha: 0, beta: 1 },
  },
];
```

