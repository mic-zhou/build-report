# build-report

零依赖 node 脚本：构建产物体积分析报告 + dist 清理。可直接执行，也可在 vite.config 中作为插件调用。适合 webpack / vite / rollup 等任何能产出 `build-stats.json` 的构建链路。

## 安装

```bash
npm install build-report -D
```

## analysis —— 构建产物分析

读取 `reports/build-stats.json`（由 rollup-plugin-visualizer 的 `raw-data` 模式导出），输出：

1. **终端文本报告**：总体积 / gzip、Top 10 chunk、Top 10 依赖目录、Top 10 文件
2. **Markdown 报告** `reports/build-report.md`：Top 20 chunk / 依赖 / 文件三张表，方便归档和对比

### 作为 vite 插件（构建结束自动分析）

```js
// vite.config.js
import { visualizer } from 'rollup-plugin-visualizer'

const analysisPlugin = {
  name: 'vite-plugin-build-analysis',
  apply: 'build',
  async closeBundle() {
    const { analyzeBuild } = await import('build-report/analysis')
    analyzeBuild()
  }
}

export default {
  plugins: [
    visualizer({
      filename: 'reports/build-stats.json',
      template: 'raw-data',
      gzipSize: true,
      brotliSize: true
    }),
    analysisPlugin
  ]
}
```

### 单独执行

```bash
node node_modules/build-report/scripts/build-analysis.mjs
```

### 导出函数

| 函数 | 说明 |
|------|------|
| `analyzeBuild()` | 读取 `process.cwd()/reports/build-stats.json` 生成终端 + Markdown 报告；文件不存在时打印提示并跳过 |

报告的 Markdown 表格示例：

```markdown
## Top 20 大体积 chunk
| # | 名称 | 大小 | gzip |
| 1 | vendor-echarts | 1.20 MB | 380.5 KB |
```

## clean —— 清理构建产物

清空 dist 目录内容（保留目录本身），并删除项目根目录下以 `package.json` `name` 开头的 zip 文件。

### 作为 vite 插件（构建前清理）

```js
// vite.config.js
const cleanPlugin = {
  name: 'vite-plugin-clean-build',
  apply: 'build',
  async buildStart() {
    const { cleanBuild } = await import('build-report/clean')
    cleanBuild()
  }
}
```

### 单独执行

```bash
node node_modules/build-report/scripts/clean.mjs
# 或 package.json scripts: { "clean": "node node_modules/build-report/scripts/clean.mjs" }
```

### 导出函数

| 函数 | 说明 |
|------|------|
| `cleanBuild()` | 清空 `process.cwd()/dist` + 删除项目名开头的 zip；dist 不存在时自动创建 |

## 特性

- 零第三方依赖（仅 node 内置模块 `fs` / `path`）
- 脚本可直接执行（`node xxx.mjs`），也可被 import 后调用（自动判断运行方式）
- Node >= 16

## License

[MIT](./LICENSE)
