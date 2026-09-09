import {
  createSkillsMiddleware as upstreamCreateSkillsMiddleware,
  type SkillsMiddlewareOptions,
  type SkillMetadata
} from 'deepagents'
import { SystemMessage } from '@langchain/core/messages'
import type { AgentMiddleware } from 'langchain'

export const MANDATORY_SKILL_CONTRACT_PROMPT = `
### Slash Commands & Skill Ingestion
Users can invoke skills directly via slash commands (e.g., \`/{skill-name}\`). When a user invokes a skill or when the system detects an explicit skill request, you will receive an injected \`<SKILL>\` tag in the prompt:

\`\`\`xml
<SKILL>The user requested you read and use the "{skill_name}" skill. The path to the skill file is:
{skill_path}</SKILL>
\`\`\`

### MANDATORY AGENT CONTRACT:
1. **Explicit Skill Invocations (<SKILL> tag)**:
   When you receive an injected \`<SKILL>\` tag in the prompt, you MUST IMMEDIATELY call \`read_file\` on the provided skill file path BEFORE executing any user request, running any commands, or generating code/answers.
2. **Implicit Relevance**:
   If the user's task matches the domain, keywords, or purpose of an available skill, you MUST read its \`SKILL.md\` via \`read_file\` before starting work.
3. **Strict Compliance**:
   Follow the workflows, steps, checklists, and instructions in the skill's \`SKILL.md\` file. Do not invent steps that contradict the skill guidelines.
`.trim()

/**
 * Enhanced SkillsMiddleware for CollarAgent.
 *
 * Wraps upstream deepagents createSkillsMiddleware to enforce:
 * - Direct recognition of <SKILL> metadata injection tags from slash commands
 * - Mandatory Agent Contract requiring read_file on relevant SKILL.md before execution
 * - Seamless preservation of stateSchema and skillsMetadata across subagents
 */
export function createSkillsMiddleware(options: SkillsMiddlewareOptions): AgentMiddleware {
  const baseMiddleware = upstreamCreateSkillsMiddleware(options)
  const originalWrapModelCall = baseMiddleware.wrapModelCall

  if (originalWrapModelCall) {
    baseMiddleware.wrapModelCall = (request, handler) => {
      return originalWrapModelCall(request, (innerRequest) => {
        let systemMessage = innerRequest.systemMessage

        const contentStr = typeof systemMessage?.content === 'string' ? systemMessage.content : ''

        if (systemMessage && !contentStr.includes('### MANDATORY AGENT CONTRACT:')) {
          if (typeof systemMessage.concat === 'function') {
            systemMessage = systemMessage.concat(`\n\n${MANDATORY_SKILL_CONTRACT_PROMPT}`)
          } else if (typeof systemMessage.content === 'string') {
            systemMessage = new SystemMessage({
              content: `${systemMessage.content}\n\n${MANDATORY_SKILL_CONTRACT_PROMPT}`
            })
          }
        }

        return handler({
          ...innerRequest,
          systemMessage
        })
      })
    }
  }

  return baseMiddleware
}

export { type SkillsMiddlewareOptions, type SkillMetadata }
