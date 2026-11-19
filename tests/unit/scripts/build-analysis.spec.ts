/**
 * scripts/build-analysis.mjs —— 构建产物体积分析脚本
 *
 * 该脚本读取 reports/build-stats.json（rollup-plugin-visualizer 导出的 tree + nodeParts），
 * 输出终端文本报告并写出 reports/build-report.md。
 * 同样把 cwd 桩到临时沙箱，用真实 fs 读写，从而校验排序、路径美化、归属聚合等计算结果。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const KB = 1024
const MB = 1024 * 1024

let sandbox = ''
let cwdSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>

const statsPath = () => join(sandbox, 'reports', 'build-stats.json')
const reportPath = () => join(sandbox, 'reports', 'build-report.md')
const logs = () => logSpy.mock.calls.map((args) => String(args[0])).join('\n')

const writeStats = (data: unknown) => {
  mkdirSync(join(sandbox, 'reports'), { recursive: true })
  writeFileSync(statsPath(), JSON.stringify(data), 'utf-8')
}

const analyzeBuild = async () => {
  const mod = (await import('../../../scripts/build-analysis.mjs')) as { analyzeBuild: () => void }
  mod.analyzeBuild()
}

/**
 * 覆盖各计算分支的夹具：
 * - 叶子体积横跨 MB / KB / B 三档（fmt）
 * - 归属横跨 @scope/包、普通包、src/ 一级目录、other、unknown（topLevelOwner）
 * - 路径横跨 Windows 反斜杠、盘符截断、node_modules 截断、src 截断、无可截断（cleanPath）
 * - 结构横跨 多层 children、children: []、无 uid 叶子、nodeParts 缺 renderedLength
 */
const FIXTURE = {
  tree: {
    name: '',
    children: [
      {
        name: 'static/js/index.js',
        children: [
          { name: 'D:/proj/src/views/index.vue', uid: 'u1' },
          { name: 'D:/proj/node_modules/@scope/pkg/lib/index.js', uid: 'u2' },
          {
            name: 'nested',
            children: [
              { name: 'D:\\proj\\node_modules\\vue\\dist\\vue.esm.js', uid: 'u3' },
              { name: 'weird-module' }
            ]
          }
        ]
      },
      {
        name: 'static/js/vendor.js',
        children: [
          { name: 'D:/proj/node_modules/@scope/solo.js', uid: 'u4' },
          { name: 'D:/proj/src/utils/base.ts', uid: 'u5' }
        ]
      },
      {
        name: 'static/js/tail.js',
        children: [{ name: 'D:/proj/node_modules/', uid: 'u6' }]
      },
      { name: 'static/js/empty.js', children: [] }
    ]
  },
  nodeParts: {
    u1: { renderedLength: 3 * MB, gzipLength: MB, brotliLength: 900000 },
    u2: { renderedLength: 5 * KB, gzipLength: 2 * KB },
    u3: { renderedLength: 2 * KB, gzipLength: 1024 },
    u4: { renderedLength: KB, gzipLength: 512 },
    u5: { renderedLength: 512, gzipLength: 100 },
    u6: { gzipLength: 7 }
  }
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'fais-analysis-'))
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(sandbox)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  cwdSpy.mockRestore()
  logSpy.mockRestore()
  rmSync(sandbox, { recursive: true, force: true })
})

describe('scripts/build-analysis.mjs analyzeBuild', () => {
  it('未生成 build-stats.json 时跳过分析且不写报告', async () => {
    await analyzeBuild()

    expect(logs()).toContain('未找到 reports/build-stats.json, 跳过分析')
    expect(existsSync(reportPath())).toBe(false)
  })

  it('终端报告：总量、chunk 体积降序、归属聚合、单文件路径美化', async () => {
    writeStats(FIXTURE)

    await analyzeBuild()

    const out = logs()
    // 叶子共 8 个；总量 3145728+5120+2048+1024+512 = 3154432 B，gzip 1052267 B
    expect(out).toContain('总大小: 3.01 MB   gzip: 1.00 MB   chunk数: 4  模块数: 8')
    expect(out).toContain('Top 10 大体积 chunk')
    expect(out).toContain('(gzip 1.00 MB)  static/js/index.js')
    expect(out).toContain('(gzip 612 B)  static/js/vendor.js')
    // 体积为 0 的空 chunk 排在最后
    expect(out.indexOf('static/js/vendor.js')).toBeLessThan(out.indexOf('static/js/tail.js'))
    expect(out.indexOf('static/js/tail.js')).toBeLessThan(out.indexOf('static/js/empty.js'))
    // 归属聚合：作用域包、普通包、src 一级目录、other、unknown
    expect(out).toContain('  src/views')
    expect(out).toContain('  @scope/pkg')
    expect(out).toContain('  vue')
    expect(out).toContain('  @scope/')
    expect(out).toContain('  src/utils')
    expect(out).toContain('  other')
    expect(out).toContain('  unknown')
    // 路径美化：反斜杠归一 + 截掉盘符前的绝对路径
    expect(out).toContain('  node_modules/vue/dist/vue.esm.js')
    expect(out).toContain('  src/utils/base.ts')
    // 无任何可截断标记的裸路径原样保留，且 renderedLength 缺失按 0 计
    expect(out).toContain('(gzip 0 B)  static/js/index.js/nested/weird-module')
  })

  it('写出 Markdown 报告：总览 + 三张 Top 表格', async () => {
    writeStats(FIXTURE)

    await analyzeBuild()

    const md = readFileSync(reportPath(), 'utf-8')
    expect(md).toContain('# 构建产物体积分析报告')
    expect(md).toContain('> 生成时间: ')
    expect(md).toContain('| 总大小 | gzip | chunk数 | 模块数 |')
    expect(md).toContain('| 3.01 MB | 1.00 MB | 4 | 8 |')
    expect(md).toContain('## Top 20 大体积 chunk')
    expect(md).toContain('## Top 20 大体积依赖/目录')
    expect(md).toContain('## Top 20 大体积文件')
    // 名称/路径用行内代码包裹，体积走 fmt()，序号列是裸数字（`1.` 只在终端报告里出现）
    expect(md).toContain('| 1 | `static/js/index.js` | 3.01 MB | 1.00 MB |')
    expect(md).toContain('| 2 | `static/js/vendor.js` | 1.5 KB | 612 B |')
    expect(md).toContain('| 1 | `src/views` | 3.00 MB | 1.00 MB |')
    expect(md).toContain('| 2 | `@scope/pkg` | 5.0 KB | 2.0 KB |')
    expect(md).toContain(
      '| 1 | `src/views/index.vue` | `static/js/index.js` | 3.00 MB | 1.00 MB |'
    )
    expect(md).toContain(
      '| 2 | `node_modules/@scope/pkg/lib/index.js` | `static/js/index.js` | 5.0 KB | 2.0 KB |'
    )
    // 末列之后的行：所属 chunk 与模块路径同列规则
    expect(md).toContain('| 6 | `static/js/index.js/nested/weird-module` |')
    expect(logs()).toContain('已生成报告')
  })

  it('归属与体积的兜底值：空包名、空一级目录、缺失 gzipLength', async () => {
    // 三个叶子分别命中 topLevelOwner 的 (parts[1] || '')、('src/' + (parts[0] || ''))
    // 以及 collectLeaves / subtreeGzip 的 (gzipLength || 0)
    writeStats({
      tree: {
        name: '',
        children: [
          {
            name: 'static/js/edge.js',
            children: [
              { name: 'D:/proj/node_modules/@scope/', uid: 'e1' },
              { name: 'D:/proj/src/', uid: 'e2' },
              { name: 'D:/proj/node_modules/echarts/index.js', uid: 'e3' }
            ]
          }
        ]
      },
      nodeParts: {
        e1: { renderedLength: 10 },
        e2: { renderedLength: 20 },
        e3: { renderedLength: 30 }
      }
    })

    await analyzeBuild()

    const out = logs()
    expect(out).toContain('总大小: 60 B   gzip: 0 B   chunk数: 1  模块数: 3')
    // 作用域包缺子名 -> "@scope/"，src 下无一级目录 -> "src/"，普通包 -> 包名
    expect(out).toContain('(gzip 0 B)  echarts')
    expect(out).toContain('(gzip 0 B)  src/')
    expect(out).toContain('(gzip 0 B)  @scope/')

    const md = readFileSync(reportPath(), 'utf-8')
    expect(md).toContain('| 1 | `static/js/edge.js` | 60 B | 0 B |')
    expect(md).toContain('| 2 | `src/` | 20 B | 0 B |')
    expect(md).toContain('| 3 | `@scope/` | 10 B | 0 B |')
    expect(md).toContain(
      '| 1 | `node_modules/echarts/index.js` | `static/js/edge.js` | 30 B | 0 B |'
    )
    expect(md).toContain('| 2 | `src/` | `static/js/edge.js` | 20 B | 0 B |')
    expect(md).toContain('| 3 | `node_modules/@scope/` | `static/js/edge.js` | 10 B | 0 B |')
  })

  it('tree / nodeParts 缺失时按空数据处理', async () => {
    writeStats({ tree: { name: '' } })
    await analyzeBuild()
    expect(logs()).toContain('总大小: 0 B   gzip: 0 B   chunk数: 0  模块数: 0')
    expect(readFileSync(reportPath(), 'utf-8')).toContain('| 0 B | 0 B | 0 | 0 |')

    logSpy.mockClear()
    writeStats({ nodeParts: {} })
    await analyzeBuild()
    expect(logs()).toContain('chunk数: 0  模块数: 0')
  })

  it('以 node scripts/build-analysis.mjs 方式直接执行时自动分析一次', async () => {
    writeStats(FIXTURE)
    const original = process.argv[1]
    process.argv[1] = join(sandbox, 'scripts', 'build-analysis.mjs')
    vi.resetModules()
    logSpy.mockClear()
    try {
      await import('../../../scripts/build-analysis.mjs')
    } finally {
      process.argv[1] = original
    }

    expect(existsSync(reportPath())).toBe(true)
    expect(
      logSpy.mock.calls.filter((args) => String(args[0]).includes('已生成报告')).length
    ).toBe(1)
  })
})
