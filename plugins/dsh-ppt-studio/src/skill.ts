/**
 * 技能注册：把随包分发的 skills/dsh-ppt-studio/SKILL.md 注册进 DSH 技能注册表。
 *（模式与 dsh-ppt-master/src/skill.ts 一致：frontmatter 解析零依赖，缺失只告警。）
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export interface SkillRegistration {
  name: string
  description: string
  content: string
  resourceBase: { kind: 'directory'; path: string }
  source?: string
}

export interface SkillsService {
  register(definition: SkillRegistration): () => void
}

export const SKILL_NAMES = ['dsh-ppt-studio'] as const

/** 随包分发的技能目录绝对路径。 */
export function bundledSkillsDir(): string {
  return fileURLToPath(new URL('../skills/', import.meta.url))
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').trim()
  }
  return trimmed
}

export function parseSkillFile(text: string): { name: string; description: string; content: string } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/.exec(normalized)
  if (match === null) return { name: '', description: '', content: normalized }
  let name = ''
  let description = ''
  for (const rawLine of match[1].split('\n')) {
    const keyMatch = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/.exec(rawLine.trim())
    if (keyMatch === null) continue
    if (keyMatch[1] === 'name') name = unquoteYamlScalar(keyMatch[2])
    else if (keyMatch[1] === 'description') description = unquoteYamlScalar(keyMatch[2])
  }
  return { name, description, content: normalized.slice(match[0].length).trimStart() }
}

/** 注册技能；文件缺失或 frontmatter 不完整抛错（由调用方降级为告警）。 */
export function registerPptStudioSkill(ctx: { skills: SkillsService }): () => void {
  const skillName = SKILL_NAMES[0]
  const dir = join(bundledSkillsDir(), skillName)
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const parsed = parseSkillFile(text)
  if (parsed.name === '' || parsed.description === '' || parsed.content === '') {
    throw new Error(`技能 ${skillName} 的 frontmatter 不完整（name/description/content 均不能为空）`)
  }
  return ctx.skills.register({
    name: parsed.name,
    description: parsed.description,
    content: parsed.content,
    resourceBase: { kind: 'directory', path: dir },
    source: 'runtime',
  })
}
