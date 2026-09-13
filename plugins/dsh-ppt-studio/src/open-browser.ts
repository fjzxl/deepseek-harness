/**
 * 跨平台打开浏览器（渲染/即时预览后自动唤起预览窗口）。
 * 尽力而为：失败只返回 false，不抛错（预览 URL 始终会以文字形式给用户）。
 */
import { spawn } from 'node:child_process'
import type { DeckStore } from './deck-store.js'
import type { PreviewAutoOpenMode } from './config.js'

export function openBrowser(url: string): boolean {
  try {
    const platform = process.platform
    const child =
      platform === 'win32'
        ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' })
        : platform === 'darwin'
          ? spawn('open', [url], { detached: true, stdio: 'ignore' })
          : spawn('xdg-open', [url], { detached: true, stdio: 'ignore' })
    child.unref()
    return true
  } catch {
    return false
  }
}

/**
 * 按 previewAutoOpen 模式自动打开预览（0.7.2 用户反馈：生成期间每次 preview/render 都弹一个新窗口）：
 *   'once'（默认）——**每个阶段各只弹第一次**（0.8.1 细化）：即时预览首开记 state.previewOpenedAt、
 *    正式渲染首开记 state.renderOpenedAt（渲染产物可能有变化，值得再看一眼）；各自跨调用/重启不重复弹；
 *   'always'——每次都打开（0.7.2 之前的旧行为）；
 *   false——不打开。
 * kind 参数区分阶段；open 参数供测试注入（默认真实 openBrowser）。
 */
export async function openPreviewOncePerDeck(
  store: DeckStore,
  deckId: string,
  url: string,
  mode: PreviewAutoOpenMode,
  kind: 'preview' | 'render' = 'preview',
  open: (url: string) => boolean = openBrowser,
): Promise<boolean> {
  if (mode === false) return false
  if (mode === 'once') {
    const state = await store.loadState(deckId)
    const field = kind === 'render' ? 'renderOpenedAt' : 'previewOpenedAt'
    if (state === undefined || state[field] !== undefined) return false
    const opened = open(url)
    if (opened) {
      state[field] = new Date().toISOString()
      await store.saveState(state)
    }
    return opened
  }
  return open(url)
}
