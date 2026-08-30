/** List all skills from all configured source directories */
export const SKILLS_LIST = 'skills:list';

/** Read the raw content of a file at a given absolute path */
export const SKILLS_READ_FILE = 'skills:read-file';

/** Write content to a file at a given absolute path */
export const SKILLS_WRITE_FILE = 'skills:write-file';

/** Create a new skill: make a named directory + empty SKILL.md template */
export const SKILLS_CREATE = 'skills:create';

/** Delete a skill directory recursively */
export const SKILLS_DELETE = 'skills:delete';

/** Open Electron's native folder-picker dialog, return selected path */
export const SKILLS_PICK_DIRECTORY = 'skills:pick-directory';
