# build-report

零依赖 node 脚本：构建产物体积分析报告 + dist 清理。可直接执行，也可在 vite.config 中作为插件调用。

## 安装

```bash
npm install build-report -D
```

## analysis —— 构建产物分析

读取 `reports/build-stats.json`（由 rollup-plugin-visualizer 的 `raw-data` 模式导出），输出终端文本报告（Top chunk / 依赖 / 文件），并生成 `reports/build-report.md`。

```js
// vite.config.js —— 构建结束自动分析
const analysisPlugin = {
  name: 'vite-plugin-build-analysis',
  apply: 'build',
  async closeBundle() {
    const { analyzeBuild } = await import('build-report/analysis')
    analyzeBuild()
  }
}
```

```bash
# 也可单独执行
node node_modules/build-report/scripts/build-analysis.mjs
```

配套的 visualizer 配置：

```js
visualizer({ filename: 'reports/build-stats.json', template: 'raw-data', gzipSize: true, brotliSize: true })
```

## clean —— 清理构建产物

清空 dist 目录内容，并删除项目根目录下以 package.json name 开头的 zip 文件。

```js
import { cleanBuild } from 'build-report/clean'
```

```bash
node node_modules/build-report/scripts/clean.mjs
```

## 特性

- 零第三方依赖（仅 node 内置模块）
- Node >= 16

## License

[MIT](./LICENSE)
