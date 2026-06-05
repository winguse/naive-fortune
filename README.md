# naive-fortune

纯前端 ETF 定投辅助工具（React + TypeScript + Vite），可长期部署到 GitHub Pages。

## 技术栈

- Vite + React + TypeScript
- Zustand（状态）
- React Router
- Dexie / IndexedDB（本地结构化存储）
- React Hook Form + Zod（表单与校验）
- Apache ECharts（图表）
- Vitest + React Testing Library（测试）
- ESLint + Prettier

## 本地运行

```bash
npm install
npm run dev
```

## 测试 / 构建

```bash
npm run lint
npm run test:run
npm run build
```

## 市场数据说明

支持标的：

- US: FXAIX, QQQM（Stooq）
- CN: 159399, 159222, 563020, 510050, 510300（Eastmoney）

统一 CSV 格式：

```csv
date,close,open
2024-01-02,100.0,99.0
```

## 数据更新方式

```bash
npm run market-data:update
```

如果需要使用 Stooq 数据源，请先设置环境变量 `STOOQ_API_KEY`：

```bash
export STOOQ_API_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
npm run market-data:update
```

脚本位置：`scripts/update-market-data/index.mjs`

能力：

- 按标的读取并增量合并数据
- 校验表头、日期合法性、升序、去重、价格合法性
- 保证新文件日期集合是旧集合的超集
- 默认不覆盖历史同日值（除非启用 `--fix-mode=true`）

## GitHub Pages 部署

### Workflow A: `Update Market Data`

- 触发：`schedule` + `workflow_dispatch`
- 拉取默认分支与 `market-data` 分支
- 执行增量更新脚本并校验
- 强制推送覆盖 `market-data` 分支

### Workflow B: `Build and Deploy Pages`

- 触发：默认分支 push，或 Workflow A 成功后
- 拉取 `market-data` 分支数据到 `public/market-data`
- 执行测试与构建
- 部署 `dist` 到 `gh-pages` 分支

## 数据导入导出

- 全量 JSON 导入导出
- 包含 `schemaVersion`
- 导入支持：覆盖 / 追加

## 已知限制

- 当前为 MVP，记录管理编辑交互为简化版
- 回测为基础实现（默认日频、可选开盘价）
- 汇率使用手动配置（后续可扩展自动更新）
