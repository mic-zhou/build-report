/**
 * scripts/clean.mjs —— 构建产物清理脚本
 *
 * 该脚本以 process.cwd() 作为项目根目录，所以这里把 cwd 桩到系统临时沙箱，
 * 用真实的 fs 验证「清空 dist / 删除项目名 zip」的效果，
 * 既能断言文件系统状态，也不会误伤仓库里的 dist 与 zip。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const PROJECT_NAME = 'fais_template_web_vue3_ts'

let sandbox = ''
let cwdSpy: ReturnType<typeof vi.spyOn>
let logSpy: ReturnType<typeof vi.spyOn>

/** 以「脚本被 vite 插件 import 后调用」的方式执行 cleanBuild */
const runCleanBuild = async () => {
  const { cleanBuild } = (await import('../../../scripts/clean.mjs')) as { cleanBuild: () => void }
  cleanBuild()
}

/** 搭建一个最小项目根目录：package.json + 可选 dist 内容 + 可选 zip */
const writeSandboxFile = (rel: string, content: string) => {
  const target = join(sandbox, rel)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content, 'utf-8')
}

beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'fais-clean-'))
  writeSandboxFile('package.json', JSON.stringify({ name: PROJECT_NAME }))
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(sandbox)
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(() => {
  cwdSpy.mockRestore()
  logSpy.mockRestore()
  rmSync(sandbox, { recursive: true, force: true })
})

describe('scripts/clean.mjs cleanBuild', () => {
  it('dist 存在时递归清空目录并删除普通文件（保留 dist 本身）', async () => {
    writeSandboxFile(join('dist', 'index.html'), '<html></html>')
    writeSandboxFile(join('dist', 'assets', 'index-abc123.js'), 'console.log(1)')
    writeSandboxFile(join('dist', 'assets', 'img', 'logo.svg'), '<svg></svg>')

    await runCleanBuild()

    expect(existsSync(join(sandbox, 'dist'))).toBe(true)
    expect(existsSync(join(sandbox, 'dist', 'index.html'))).toBe(false)
    expect(existsSync(join(sandbox, 'dist', 'assets'))).toBe(false)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已清空 dist 目录内容'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('开始清理旧构建产物'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('清理完成'))
  })

  it('dist 不存在时创建空目录', async () => {
    expect(existsSync(join(sandbox, 'dist'))).toBe(false)

    await runCleanBuild()

    expect(existsSync(join(sandbox, 'dist'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已创建dist目录'))
  })

  it('只删除以 package.json name 开头的 zip，其余文件保持不动', async () => {
    mkdirSync(join(sandbox, 'dist'), { recursive: true })
    writeSandboxFile(`${PROJECT_NAME}-0.0.1.zip`, 'zip-a')
    writeSandboxFile(`${PROJECT_NAME}.zip`, 'zip-b')
    writeSandboxFile('other-package.zip', 'zip-c')
    writeSandboxFile('README.md', 'keep me')

    await runCleanBuild()

    expect(existsSync(join(sandbox, `${PROJECT_NAME}-0.0.1.zip`))).toBe(false)
    expect(existsSync(join(sandbox, `${PROJECT_NAME}.zip`))).toBe(false)
    expect(existsSync(join(sandbox, 'other-package.zip'))).toBe(true)
    expect(existsSync(join(sandbox, 'README.md'))).toBe(true)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`已删除: ${PROJECT_NAME}.zip`))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('已删除2个zip文件'))
  })

  it('没有需要清理的 zip 时给出提示', async () => {
    mkdirSync(join(sandbox, 'dist'), { recursive: true })

    await runCleanBuild()

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('未找到需要清理的zip文件'))
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('已删除'))
  })

  it('以 node scripts/clean.mjs 方式直接执行时自动运行一次清理', async () => {
    writeSandboxFile(join('dist', 'index.html'), '<html></html>')
    writeSandboxFile(`${PROJECT_NAME}.zip`, 'zip')
    const original = process.argv[1]
    process.argv[1] = join(sandbox, 'scripts', 'clean.mjs')
    vi.resetModules()
    try {
      await import('../../../scripts/clean.mjs')
    } finally {
      process.argv[1] = original
    }

    expect(existsSync(join(sandbox, 'dist', 'index.html'))).toBe(false)
    expect(existsSync(join(sandbox, `${PROJECT_NAME}.zip`))).toBe(false)
    // 「清理完成」只打印一次，说明自执行分支恰好触发一次 cleanBuild
    expect(
      logSpy.mock.calls.filter((args) => String(args[0]).includes('清理完成')).length
    ).toBe(1)
  })
})
