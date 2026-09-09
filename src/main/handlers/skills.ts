import { ipcMain, dialog, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { ConfigManager } from '../config/ConfigManager'
import { listSkills } from '../../collaragent/skills/loader'
import * as Channels from '../../shared/ipc/skills/channels'
import type * as Types from '../../shared/ipc/skills/types'

const SKILL_MD_TEMPLATE = (name: string) => `---
name: ${name}
description: Describe what this skill does in one sentence (max 1024 chars).
---

# ${name}

## When to Use
- Describe when the agent should apply this skill.

## Instructions
Step-by-step instructions for the agent to follow.

## Examples
Provide examples if helpful.
`

/**
 * Locate the built-in skills directory across development and production environments.
 */
export function getBuiltinSkillsDir(): string | null {
  const candidates: Array<string | undefined> = [
    ...(app?.getAppPath ? [path.join(app.getAppPath(), 'src/collaragent/skills')] : []),
    path.join(process.cwd(), 'src/collaragent/skills'),
    path.join(__dirname, '../../src/collaragent/skills'),
    path.join(__dirname, '../collaragent/skills'),
    process.resourcesPath ? path.join(process.resourcesPath, 'skills') : undefined
  ]

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

/**
 * Retrieve all skills from built-in and user-configured sources.
 */
export function getAllSkills(
  configManager: ConfigManager,
  sourceOverride?: string
): {
  skills: Types.SkillEntry[]
  errors: Array<{ source: string; error: string }>
} {
  const config = configManager.getConfig()
  const sourcePath = sourceOverride ?? config.middleware?.skills?.source ?? ''
  const skillsMap = new Map<string, Types.SkillEntry>()
  const errors: Array<{ source: string; error: string }> = []

  // 1. Built-in skills (baseline)
  const builtinDir = getBuiltinSkillsDir()
  if (builtinDir) {
    try {
      const builtinLoaded = listSkills({
        userSkillsDir: null,
        projectSkillsDir: builtinDir
      })
      for (const skill of builtinLoaded) {
        skillsMap.set(skill.name.toLowerCase(), {
          name: skill.name,
          description: skill.description,
          skillMdPath: skill.path,
          skillDirPath: path.dirname(skill.path),
          sourcePath: 'builtin',
          license: skill.license,
          compatibility: skill.compatibility
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ source: 'builtin', error: message })
    }
  }

  // 2. User-configured skills (overrides baseline if same name)
  if (sourcePath) {
    try {
      const expandedSource = sourcePath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', sourcePath.slice(1))
        : sourcePath

      const userLoaded = listSkills({
        userSkillsDir: expandedSource,
        projectSkillsDir: null
      })

      for (const skill of userLoaded) {
        skillsMap.set(skill.name.toLowerCase(), {
          name: skill.name,
          description: skill.description,
          skillMdPath: skill.path,
          skillDirPath: path.dirname(skill.path),
          sourcePath,
          license: skill.license,
          compatibility: skill.compatibility
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ source: sourcePath, error: message })
    }
  }

  return { skills: Array.from(skillsMap.values()), errors }
}

/**
 * Resolve a skill by name across all sources.
 */
export function resolveSkillByName(
  name: string,
  configManager: ConfigManager
): Types.SkillEntry | null {
  const { skills } = getAllSkills(configManager)
  const normalized = name.toLowerCase().trim()
  return skills.find((s) => s.name.toLowerCase() === normalized) || null
}

export function registerSkillsHandlers(configManager: ConfigManager) {
  // List all skills from both builtin and user sources
  ipcMain.handle(
    Channels.SKILLS_LIST,
    async (_, req: Types.SkillsListRequest): Promise<Types.SkillsListResponse> => {
      return getAllSkills(configManager, req.source)
    }
  )

  // Read file content
  ipcMain.handle(
    Channels.SKILLS_READ_FILE,
    async (_, req: Types.SkillsReadFileRequest): Promise<Types.SkillsReadFileResponse> => {
      const content = fs.readFileSync(req.path, 'utf-8')
      return { content }
    }
  )

  // Write file content
  ipcMain.handle(
    Channels.SKILLS_WRITE_FILE,
    async (_, req: Types.SkillsWriteFileRequest): Promise<Types.SkillsWriteFileResponse> => {
      fs.writeFileSync(req.path, req.content, 'utf-8')
      return { success: true }
    }
  )

  // Create a new skill directory + SKILL.md template
  ipcMain.handle(
    Channels.SKILLS_CREATE,
    async (_, req: Types.SkillsCreateRequest): Promise<Types.SkillsCreateResponse> => {
      const expandedSource = req.sourcePath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', req.sourcePath.slice(1))
        : req.sourcePath

      const skillDir = path.join(expandedSource, req.name)
      fs.mkdirSync(skillDir, { recursive: true })

      const skillMdPath = path.join(skillDir, 'SKILL.md')
      fs.writeFileSync(skillMdPath, SKILL_MD_TEMPLATE(req.name), 'utf-8')

      return { skillMdPath, success: true }
    }
  )

  // Delete a skill directory
  ipcMain.handle(
    Channels.SKILLS_DELETE,
    async (_, req: Types.SkillsDeleteRequest): Promise<Types.SkillsDeleteResponse> => {
      fs.rmSync(req.skillDirPath, { recursive: true, force: true })
      return { success: true }
    }
  )

  // Open native folder picker dialog
  ipcMain.handle(
    Channels.SKILLS_PICK_DIRECTORY,
    async (): Promise<Types.SkillsPickDirectoryResponse> => {
      const result = await dialog.showOpenDialog({
        title: 'Select Skills Directory',
        properties: ['openDirectory', 'createDirectory']
      })
      return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
    }
  )
}
