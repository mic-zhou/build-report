/**
 * 构建产物分析脚本
 * 读取 rollup-plugin-visualizer 导出的原始数据(reports/build-stats.json),
 * 生成终端文本报告 + Markdown 分析报告(reports/build-report.md)。
 * 使用：构建完成后自动由 vite.config.js 中的插件调用, 也可单独执行 node scripts/build-analysis.mjs
 */

import fs from 'fs'
import path from 'path'

const KB = 1024
const MB = 1024 * 1024

function fmt(bytes = 0) {
  if (bytes >= MB) return (bytes / MB).toFixed(2) + ' MB'
  if (bytes >= KB) return (bytes / KB).toFixed(1) + ' KB'
  return bytes + ' B'
}

// 从完整模块路径提取顶层归属(依赖包名 或 src/ 一级目录)
function topLevelOwner(fullPath = '') {
  const norm = fullPath.split('\\').join('/')
  const ni = norm.indexOf('node_modules/')
  if (ni !== -1) {
    const rest = norm.slice(ni + 'node_modules/'.length)
    const parts = rest.split('/')
    if (parts[0] && parts[0].startsWith('@')) return parts[0] + '/' + (parts[1] || '')
    return parts[0] || 'unknown'
  }
  const si = norm.indexOf('/src/')
  if (si !== -1) {
    const parts = norm.slice(si + 5).split('/')
    return 'src/' + (parts[0] || '')
  }
  return 'other'
}

// 遍历 chunk 子树, 收集叶子模块(带 uid)并拼接完整路径
// nodeParts: uid -> { renderedLength, gzipLength, brotliLength }
// chunkName: 当前所属 chunk 名(用于后续展示归属)
function collectLeaves(node, prefix, nodeParts, chunkName, out) {
  const children = node && node.children
  const curPath = prefix ? prefix + '/' + node.name : node.name
  if (children && children.length) {
    children.forEach((c) => collectLeaves(c, curPath, nodeParts, chunkName, out))
  } else {
    const uid = node.uid
    const part = uid ? nodeParts[uid] : null
    out.push({
      name: curPath,
      chunk: chunkName,
      size: part ? part.renderedLength || 0 : 0,
      gzip: part ? part.gzipLength || 0 : 0,
      brotli: part ? part.brotliLength || 0 : 0
    })
  }
}

// 美化模块路径: 去掉 chunk 前缀和项目绝对路径, 保留可读的相对路径
function cleanPath(fullPath = '') {
  const norm = fullPath.split('\\').join('/')
  // 去掉 chunk 名前缀(如 "static/js/xxx.js/D:/...")
  const driveIdx = norm.search(/[A-Za-z]:\//)
  let rest = driveIdx !== -1 ? norm.slice(driveIdx) : norm
  // 去掉项目根路径, 保留 node_modules/ 或 src/ 起始的相对路径
  const nmIdx = rest.indexOf('node_modules/')
  if (nmIdx !== -1) return rest.slice(nmIdx)
  const srcIdx = rest.indexOf('/src/')
  if (srcIdx !== -1) return rest.slice(srcIdx + 1)
  return rest
}

// 计算某个节点子树的总大小(递归累加叶子 renderedLength)
function subtreeSize(node, nodeParts) {
  const children = node && node.children
  if (children && children.length) {
    return children.reduce((s, c) => s + subtreeSize(c, nodeParts), 0)
  }
  const part = node && node.uid ? nodeParts[node.uid] : null
  return part ? part.renderedLength || 0 : 0
}
function subtreeGzip(node, nodeParts) {
  const children = node && node.children
  if (children && children.length) {
    return children.reduce((s, c) => s + subtreeGzip(c, nodeParts), 0)
  }
  const part = node && node.uid ? nodeParts[node.uid] : null
  return part ? part.gzipLength || 0 : 0
}

export function analyzeBuild() {
  const file = path.join(process.cwd(), 'reports', 'build-stats.json')
  if (!fs.existsSync(file)) {
    console.log('[build-analysis] 未找到 reports/build-stats.json, 跳过分析')
    return
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const tree = data.tree
  const nodeParts = data.nodeParts || {}
  const chunks = (tree && tree.children) || []

  // chunk 列表(按体积降序)
  const chunkRows = chunks
    .map((c) => ({
      name: c.name,
      size: subtreeSize(c, nodeParts),
      gzip: subtreeGzip(c, nodeParts)
    }))
    .sort((a, b) => b.size - a.size)

  // 叶子模块(带完整路径)
  const leaves = []
  chunks.forEach((c) => collectLeaves(c, '', nodeParts, c.name, leaves))
  const totalSize = leaves.reduce((s, m) => s + m.size, 0)
  const totalGzip = leaves.reduce((s, m) => s + m.gzip, 0)

  // 按顶层归属聚合
  const ownerMap = new Map()
  leaves.forEach((m) => {
    const k = topLevelOwner(m.name)
    const e = ownerMap.get(k) || { size: 0, gzip: 0 }
    e.size += m.size
    e.gzip += m.gzip
    ownerMap.set(k, e)
  })
  const ownerRows = [...ownerMap.entries()]
    .map(([name, v]) => ({ name, size: v.size, gzip: v.gzip }))
    .sort((a, b) => b.size - a.size)

  // 单文件 Top(路径美化 + 归属 chunk)
  const fileRows = [...leaves]
    .map((m) => ({ name: cleanPath(m.name), chunk: m.chunk, size: m.size, gzip: m.gzip }))
    .sort((a, b) => b.size - a.size)

  // ===== 终端文本报告 =====
  console.log('\n========== 构建产物分析 ==========')
  console.log(
    `总大小: ${fmt(totalSize)}   gzip: ${fmt(totalGzip)}   chunk数: ${chunks.length}  模块数: ${leaves.length}`
  )
  console.log('\n-- Top 10 大体积 chunk --')
  chunkRows.slice(0, 10).forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${fmt(c.size).padStart(10)} (gzip ${fmt(c.gzip)})  ${c.name}`)
  })
  console.log('\n-- Top 10 大体积依赖/目录 --')
  ownerRows.slice(0, 10).forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${fmt(c.size).padStart(10)} (gzip ${fmt(c.gzip)})  ${c.name}`)
  })
  console.log('\n-- Top 10 大体积文件 --')
  fileRows.slice(0, 10).forEach((c, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${fmt(c.size).padStart(10)} (gzip ${fmt(c.gzip)})  ${c.name}`)
  })
  console.log('\n=================================\n')

  // ===== Markdown 报告 =====
  const lines = []
  lines.push('# 构建产物体积分析报告')
  lines.push('')
  lines.push('> 生成时间: ' + new Date().toLocaleString())
  lines.push('')
  lines.push('## 总览')
  lines.push('')
  lines.push('| 总大小 | gzip | chunk数 | 模块数 |')
  lines.push('| --- | --- | --- | --- |')
  lines.push(`| ${fmt(totalSize)} | ${fmt(totalGzip)} | ${chunks.length} | ${leaves.length} |`)
  lines.push('')

  const table = (title, rows, cols) => {
    lines.push(`## ${title}`)
    lines.push('')
    const headers = cols.map((c) => c.label).join(' | ')
    const sep = cols.map(() => '---').join(' | ')
    lines.push(`| ${headers} |`)
    lines.push(`| ${sep} |`)
    rows.forEach((r, i) => {
      const cells = cols
        .map((c) => {
          if (c.key === '#') return i + 1
          if (c.key === 'size' || c.key === 'gzip') return fmt(r[c.key])
          return '`' + r[c.key] + '`'
        })
        .join(' | ')
      lines.push(`| ${cells} |`)
    })
    lines.push('')
  }

  table('Top 20 大体积 chunk', chunkRows.slice(0, 20), [
    { key: '#', label: '#' },
    { key: 'name', label: '名称' },
    { key: 'size', label: '大小' },
    { key: 'gzip', label: 'gzip' }
  ])
  table('Top 20 大体积依赖/目录', ownerRows.slice(0, 20), [
    { key: '#', label: '#' },
    { key: 'name', label: '名称' },
    { key: 'size', label: '大小' },
    { key: 'gzip', label: 'gzip' }
  ])
  table('Top 20 大体积文件', fileRows.slice(0, 20), [
    { key: '#', label: '#' },
    { key: 'name', label: '模块路径' },
    { key: 'chunk', label: '所属chunk' },
    { key: 'size', label: '大小' },
    { key: 'gzip', label: 'gzip' }
  ])

  const mdPath = path.join(process.cwd(), 'reports', 'build-report.md')
  fs.writeFileSync(mdPath, lines.join('\n'), 'utf-8')
  console.log(`[build-analysis] 已生成报告: ${mdPath}`)
}

// 直接执行时运行
if (process.argv[1] && process.argv[1].includes('build-analysis.mjs')) {
  analyzeBuild()
}
