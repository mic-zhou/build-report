/**
 * 清理构建产物脚本
 * 用途：清空 dist 目录 + 删除以项目名开头的 zip 文件
 * 使用：npm run clean 或 node scripts/clean.mjs
 * 导出：cleanBuild() 函数供 vite.config.js 使用
 */

import fs from 'fs'
import pathModule from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

/**
 * 清理构建产物函数
 * @returns {void}
 */
export function cleanBuild() {
  // 使用 process.cwd() 作为项目根目录（更可靠，不依赖 import.meta.url）
  const rootPath = process.cwd()
  const distPath = pathModule.join(rootPath, 'dist')
  const packageJsonPath = pathModule.join(rootPath, 'package.json')

  // 动态导入 package.json（避免缓存）
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

  console.log('开始清理旧构建产物...')

  // 1. 清空 dist 目录内容（保留目录本身）
  if (fs.existsSync(distPath)) {
    const files = fs.readdirSync(distPath)
    files.forEach(file => {
      const filePath = pathModule.join(distPath, file)
      const stats = fs.statSync(filePath)
      if (stats.isDirectory()) {
        // 递归删除子目录
        fs.rmSync(filePath, { recursive: true, force: true })
      } else {
        // 删除文件
        fs.unlinkSync(filePath)
      }
    })
    console.log(`已清空 dist 目录内容`)
  } else {
    // 如果 dist 目录不存在，创建空目录
    fs.mkdirSync(distPath, { recursive: true })
    console.log(`已创建dist目录`)
  }

  // 2. 删除项目名开头的 zip 文件
  const zipFiles = fs.readdirSync(rootPath).filter(file =>
    file.startsWith(packageJson.name) && file.endsWith('.zip')
  )

  zipFiles.forEach(file => {
    const filePath = pathModule.join(rootPath, file)
    fs.unlinkSync(filePath)
    console.log(`已删除: ${file}`)
  })

  if (zipFiles.length > 0) {
    console.log(`已删除${zipFiles.length}个zip文件`)
  } else {
    console.log(`未找到需要清理的zip文件`)
  }

  console.log('清理完成！')
}

// 检测是否直接执行（作为脚本运行）
// 使用简单的方式：检查 process.argv[1] 是否包含 'clean.mjs'
if (process.argv[1] && process.argv[1].includes('clean.mjs')) {
  cleanBuild()
}
