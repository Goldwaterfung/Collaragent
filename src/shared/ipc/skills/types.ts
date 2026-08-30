/**
 * A single parsed skill entry returned from the main process.
 * Derived from the YAML frontmatter of a SKILL.md file.
 */
export interface SkillEntry {
  /** Skill name (from frontmatter `name` field) */
  name: string;
  /** Skill description (from frontmatter `description`, max 1024 chars) */
  description: string;
  /** Absolute path to the SKILL.md file itself */
  skillMdPath: string;
  /** Absolute path to the skill's parent directory */
  skillDirPath: string;
  /** Which configured source directory this came from */
  sourcePath: string;
  /** Optional: license from frontmatter */
  license?: string;
  /** Optional: compatibility notes from frontmatter */
  compatibility?: string;
}

// --- Request / Response Types ---

export interface SkillsListRequest {
  /** Source directory to scan. If empty, uses configured source from config. */
  source?: string;
}

export interface SkillsListResponse {
  skills: SkillEntry[];
  errors: Array<{ source: string; error: string }>; // non-fatal per-source errors
}

export interface SkillsReadFileRequest {
  path: string;
}

export interface SkillsReadFileResponse {
  content: string;
}

export interface SkillsWriteFileRequest {
  path: string;
  content: string;
}

export interface SkillsWriteFileResponse {
  success: boolean;
}

export interface SkillsCreateRequest {
  /** Which source directory to create the skill in */
  sourcePath: string;
  /** Skill directory name (must be lowercase-alphanumeric-with-hyphens) */
  name: string;
}

export interface SkillsCreateResponse {
  skillMdPath: string; // absolute path to the new SKILL.md
  success: boolean;
}

export interface SkillsDeleteRequest {
  skillDirPath: string;
}

export interface SkillsDeleteResponse {
  success: boolean;
}

export interface SkillsPickDirectoryRequest {}

export interface SkillsPickDirectoryResponse {
  path: string | null; // null if user cancelled the dialog
}
