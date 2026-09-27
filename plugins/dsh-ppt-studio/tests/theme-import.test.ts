/**
 * 0.21.0 P2 外部 PPTX 模板导入单测：clrScheme/fontScheme 抽取 + 8 色板派生 + 工具级集成。
 */
import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { extractPptxTheme, suggestImportedTheme } from '../src/theme-import.js'
import { resolvePptStudioConfig } from '../src/config.js'
import { createThemeTools } from '../src/tools/design.js'
import { DeckStore } from '../src/deck-store.js'

function fixturePptx(clrScheme: string, fonts = ''): Buffer {
  const theme = `<?xml version="1.0"?><a:theme xmlns:a="x"><a:themeElements>${clrScheme}${fonts}</a:themeElements></a:theme>`
  const files = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/theme/theme1.xml': strToU8(theme),
  }
  return Buffer.from(zipSync(files))
}

const CLR = (pairs: Array<[string, string]>): string =>
  `<a:clrScheme>${pairs.map(([k, v]) => `<a:${k}><a:srgbClr val="${v}"/></a:${k}>`).join('')}</a:clrScheme>`

describe('0.21.0 P2：PPTX 主题抽取', () => {
  it('抽取 clrScheme 12 色与 fontScheme（过滤 + 占位字体名）', () => {
    const pptx = fixturePptx(
      CLR([['dk1', '1A1A1A'], ['lt1', 'FAFAF6'], ['dk2', '173A66'], ['accent1', '1E4B8F'], ['accent2', '2E6FC9'], ['accent3', 'E8A33D']]),
      '<a:fontScheme><a:majorFont><a:latin typeface="+mj-lt"/><a:ea typeface="SimSun"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme>',
    )
    const ex = extractPptxTheme(pptx)
    expect(ex).toBeDefined()
    expect(ex!.clrScheme.accent1).toBe('#1E4B8F')
    expect(ex!.clrScheme.dk1).toBe('#1A1A1A')
    expect(ex!.fonts.majorLatin).toBeUndefined() // +mj-lt 占位被过滤
    expect(ex!.fonts.majorEa).toBe('SimSun')
    expect(ex!.fonts.minorLatin).toBe('Calibri')
    expect(ex!.fonts.minorEa).toBe('Microsoft YaHei')
  })

  it('sysClr lastClr 兜底解析；非 PPTX / 无主题返回 undefined', () => {
    const theme = '<a:clrScheme><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="C0504D"/></a:accent1></a:clrScheme>'
    const ex = extractPptxTheme(fixturePptx(theme))
    expect(ex!.clrScheme.dk1).toBe('#000000')
    expect(ex!.clrScheme.lt1).toBe('#FFFFFF')
    expect(extractPptxTheme(Buffer.from('not a zip'))).toBeUndefined()
    expect(extractPptxTheme(zipSyncToBuffer({ '[Content_Types].xml': strToU8('<Types/>') }))).toBeUndefined()
  })

  it('8 色板派生：accent1 过亮回退 dk2；accent2 过近派生 secondary；accent3 命中', () => {
    const ex = extractPptxTheme(fixturePptx(
      CLR([['dk1', '222222'], ['lt1', 'FDFDFD'], ['dk2', '173A66'], ['accent1', 'F1F1F1'], ['accent2', '173A60'], ['accent3', 'E07A3F']]),
    ))!
    const s = suggestImportedTheme(ex)
    expect(s.paletteOverrides.primary).toBe('#173A66') // accent1 过亮 → dk2
    expect(s.notes.some(n => n.includes('accent1'))).toBe(true)
    expect(s.paletteOverrides.accent).toBe('#E07A3F') // accent3 与主辅色距足够
    expect(s.dark).toBe(false)
    expect(s.paletteOverrides.surface).toBe('#FFFFFF')
  })

  it('accent 全近时色相旋转兜底；深色底正确判定', () => {
    const ex = extractPptxTheme(fixturePptx(
      CLR([['dk1', 'F5F5F5'], ['lt1', '14243A'], ['accent1', 'D9B56A'], ['accent2', 'D9B56A'], ['accent3', 'D9B56A']]),
    ))!
    const s = suggestImportedTheme(ex)
    expect(s.dark).toBe(true)
    expect(s.paletteOverrides.onPrimary).toBe('#14161A') // 亮主色 → 深字
    expect(s.paletteOverrides.secondary).not.toBe('#D9B56A') // 过近派生
    expect(s.paletteOverrides.accent).not.toBe('#D9B56A') // 旋转兜底
    expect(s.notes.some(n => n.includes('色相旋转'))).toBe(true)
  })
})

describe('0.21.0 P2：ppt_theme_import 工具', () => {
  it('读取工作区 PPTX 并返回建议；坏路径/非 PPTX 报错可读', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ppt-theme-import-'))
    try {
      const exec = { agent: { session: { header: { cwd: dir } } } }
      const store = new DeckStore(join(dir, 'ppt-studio'))
      const { deckId } = await store.create('模板导入测试')
      const pptxPath = join(dir, 'template.pptx')
      await writeFile(pptxPath, fixturePptx(
        CLR([['dk1', '1A1A1A'], ['lt1', 'FAFAF6'], ['dk2', '173A66'], ['accent1', '8E2420'], ['accent2', 'B0532F'], ['accent3', 'C9A227']]),
        '<a:fontScheme><a:majorFont><a:ea typeface="SimSun"/></a:majorFont><a:minorFont><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme>',
      ))
      const config = resolvePptStudioConfig({})
      const tool = createThemeTools(config).find(t => t.name === 'ppt_theme_import')!
      const result = (await tool.execute!({ deckId, path: pptxPath }, exec)) as Record<string, unknown>
      expect(result.dark).toBe(false)
      const suggestion = result.paletteSuggestion as { paletteOverrides: { primary: string }, fonts?: { title: string } }
      expect(suggestion.paletteOverrides.primary).toBe('#8E2420')
      expect(suggestion.fonts?.title).toBe('SimSun')
      await expect(tool.execute!({ deckId, path: 'missing.pptx' }, exec)).rejects.toThrow(/读取失败/)
      await writeFile(join(dir, 'bad.pptx'), 'plain text')
      await expect(tool.execute!({ deckId, path: join(dir, 'bad.pptx') }, exec)).rejects.toThrow(/不是有效的 PPTX/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function zipSyncToBuffer(files: Record<string, Uint8Array>): Buffer {
  return Buffer.from(zipSync(files))
}
