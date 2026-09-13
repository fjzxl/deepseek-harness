/**
 * 图片资产登记。
 *
 * 页面引用的每张图片必须先登记：校验格式 → 解析尺寸 → 计算 sha256 →
 * 复制冻结到 deck 的 assets/images/ → 写入 manifest（含来源与校验和）。
 * 渲染器只消费已冻结文件，绝不在最终产物中引用外部路径。
 */
import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, extname, join, resolve } from 'node:path'
import type { AssetEntry, AssetManifest } from './schema.js'
import type { DeckStore } from './deck-store.js'

const SUPPORTED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp'])

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

/** 从文件头解析图片尺寸。无法可靠解析的格式返回 undefined（登记照常，仅缺尺寸信息）。 */
export function parseImageSize(buffer: Buffer, mime: string): { width?: number; height?: number } {
  try {
    if (mime === 'image/png' && buffer.length > 24 && buffer.readUInt32BE(12) === 0x49484452) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    if (mime === 'image/gif' && buffer.length > 10 && buffer.toString('ascii', 0, 3) === 'GIF') {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
    }
    if (mime === 'image/bmp' && buffer.length > 26 && buffer.toString('ascii', 0, 2) === 'BM') {
      return { width: buffer.readInt32LE(18), height: Math.abs(buffer.readInt32LE(22)) }
    }
    if (mime === 'image/jpeg') {
      // 扫描 SOF0/1/2 段取高宽
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset++; continue }
        const marker = buffer[offset + 1]
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
        }
        const size = buffer.readUInt16BE(offset + 2)
        offset += 2 + size
      }
      return {}
    }
    if (mime === 'image/svg+xml') {
      const head = buffer.toString('utf8', 0, Math.min(buffer.length, 2048))
      const w = /width="([\d.]+)/.exec(head)?.[1]
      const h = /height="([\d.]+)/.exec(head)?.[1]
      return { width: w !== undefined ? Math.round(Number(w)) : undefined, height: h !== undefined ? Math.round(Number(h)) : undefined }
    }
  } catch {
    /* 解析失败不阻断登记 */
  }
  return {}
}

export interface RegisterAssetResult {
  assetId: string
  entry: AssetEntry
}

/**
 * 登记一张本地图片。sourcePath 相对 workspaceRoot 或绝对路径。
 */
export async function registerAsset(
  store: DeckStore,
  deckId: string,
  sourcePath: string,
  workspaceRoot: string,
  source: AssetEntry['source'] = 'local',
  bufferOverride?: Buffer,
  suggestedName?: string,
): Promise<RegisterAssetResult> {
  const absolute = resolve(workspaceRoot, sourcePath)
  const ext = extname(absolute).toLowerCase()
  if (!SUPPORTED_EXT.has(ext)) {
    throw new Error(`不支持的图片格式 ${ext || '(无扩展名)'}，支持：${[...SUPPORTED_EXT].join(' / ')}`)
  }
  const buffer = bufferOverride ?? (await readFile(absolute))
  if (buffer.byteLength === 0) throw new Error('图片文件为空')
  if (buffer.byteLength > 15 * 1024 * 1024) throw new Error('图片超过 15MB 上限')
  const mime = MIME_BY_EXT[ext]
  const { width, height } = parseImageSize(buffer, mime)
  const sha256 = createHash('sha256').update(buffer).digest('hex')

  const manifest: AssetManifest = await store.loadManifest(deckId)
  // 同图去重
  const existing = manifest.assets.find(a => a.sha256 === sha256)
  if (existing !== undefined) return { assetId: existing.assetId, entry: existing }

  const index = manifest.assets.length + 1
  const assetId = `img${String(index).padStart(2, '0')}`
  const file = `${assetId}${ext === '.jpeg' ? '.jpg' : ext}`
  const paths = store.paths(deckId)
  await mkdir(paths.imagesDir, { recursive: true })
  if (bufferOverride !== undefined) {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(paths.imagesDir, file), buffer)
  } else {
    await copyFile(absolute, join(paths.imagesDir, file))
  }

  const entry: AssetEntry = {
    assetId,
    file,
    originalPath: source === 'local' ? absolute : undefined,
    source,
    mime,
    sha256,
    bytes: buffer.byteLength,
    width,
    height,
    registeredAt: new Date().toISOString(),
  }
  manifest.assets.push(entry)
  await store.saveJson(paths.manifest, manifest)
  return { assetId, entry }
}

/** 读取资产清单中的图片字节（渲染用）。 */
export async function readAssetBuffer(store: DeckStore, deckId: string, assetId: string): Promise<{ buffer: Buffer; entry: AssetEntry } | undefined> {
  const manifest = await store.loadManifest(deckId)
  const entry = manifest.assets.find(a => a.assetId === assetId)
  if (entry === undefined) return undefined
  const buffer = await readFile(join(store.paths(deckId).imagesDir, basename(entry.file)))
  return { buffer, entry }
}
