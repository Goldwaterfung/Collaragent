import { ipcMain, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigManager } from '../config/ConfigManager';
import { listSkills } from '../../collaragent/skills/loader';
import * as Channels from '../../shared/ipc/skills/channels';
import type * as Types from '../../shared/ipc/skills/types';

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
`;

export function registerSkillsHandlers(configManager: ConfigManager) {

  // List all skills from the configured (or provided) source
  ipcMain.handle(Channels.SKILLS_LIST, async (_, req: Types.SkillsListRequest)
    : Promise<Types.SkillsListResponse> => {
    const config = configManager.getConfig();
    const sourcePath = req.source ?? config.middleware?.skills?.source ?? '';
    const skills: Types.SkillEntry[] = [];
    const errors: Array<{ source: string; error: string }> = [];

    if (!sourcePath) {
      return { skills, errors };
    }

    try {
      // Expand `~`
      const expandedSource = sourcePath.startsWith('~')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', sourcePath.slice(1))
        : sourcePath;

      // listSkills from loader already handles directory existence checks and parsing
      const loaded = listSkills({
        userSkillsDir: expandedSource,
        projectSkillsDir: null,
      });

      for (const skill of loaded) {
        skills.push({
          name: skill.name,
          description: skill.description,
          skillMdPath: skill.path,
          skillDirPath: path.dirname(skill.path),
          sourcePath,
          license: skill.license,
          compatibility: skill.compatibility,
        });
      }
    } catch (err: any) {
      errors.push({ source: sourcePath, error: err?.message ?? String(err) });
    }

    return { skills, errors };
  });

  // Read file content
  ipcMain.handle(Channels.SKILLS_READ_FILE, async (_, req: Types.SkillsReadFileRequest)
    : Promise<Types.SkillsReadFileResponse> => {
    const content = fs.readFileSync(req.path, 'utf-8');
    return { content };
  });

  // Write file content
  ipcMain.handle(Channels.SKILLS_WRITE_FILE, async (_, req: Types.SkillsWriteFileRequest)
    : Promise<Types.SkillsWriteFileResponse> => {
    fs.writeFileSync(req.path, req.content, 'utf-8');
    return { success: true };
  });

  // Create a new skill directory + SKILL.md template
  ipcMain.handle(Channels.SKILLS_CREATE, async (_, req: Types.SkillsCreateRequest)
    : Promise<Types.SkillsCreateResponse> => {
    const expandedSource = req.sourcePath.startsWith('~')
      ? path.join(process.env.HOME || process.env.USERPROFILE || '', req.sourcePath.slice(1))
      : req.sourcePath;

    const skillDir = path.join(expandedSource, req.name);
    fs.mkdirSync(skillDir, { recursive: true });

    const skillMdPath = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillMdPath, SKILL_MD_TEMPLATE(req.name), 'utf-8');

    return { skillMdPath, success: true };
  });

  // Delete a skill directory
  ipcMain.handle(Channels.SKILLS_DELETE, async (_, req: Types.SkillsDeleteRequest)
    : Promise<Types.SkillsDeleteResponse> => {
    fs.rmSync(req.skillDirPath, { recursive: true, force: true });
    return { success: true };
  });

  // Open native folder picker dialog
  ipcMain.handle(Channels.SKILLS_PICK_DIRECTORY, async ()
    : Promise<Types.SkillsPickDirectoryResponse> => {
    const result = await dialog.showOpenDialog({
      title: 'Select Skills Directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    return { path: result.canceled ? null : result.filePaths[0] ?? null };
  });
}
