# ADR-004: Progressive Disclosure Architecture for Agent Skills

## Status
**Accepted**

## Context
AI agents often require specialized domain instructions (e.g. academic paper writing, systems analysis, graph decomposition). Inlining complete skill instruction guides into the LLM system prompt consumes tens of thousands of context tokens on every invocation, dramatically inflating latency and API costs while causing prompt dilution.

## Decision
We implement the **Progressive Disclosure Pattern** adhering to Anthropic's Agent Skills specification (`https://agentskills.io/specification`):
1. **Catalog Injection**: The system prompt receives only a compact YAML frontmatter catalog containing skill names, concise descriptions, and file paths:
   ```markdown
   - **focused-execution-specialist**: Zoom into a single subsystem or node...
     → Read `/skills/user/focused-execution-specialist/SKILL.md` for full instructions
   ```
2. **On-Demand Hydration**: When the agent encounters a task matching a skill description, it reads the complete `SKILL.md` file dynamically using its standard `read_file` tool.
3. **Multi-tier Discovery**: Skills are loaded from the global user directory (`~/.deepagents/{agentName}/skills/`) and the project repository (`{projectRoot}/.deepagents/skills/`), with project-level skills taking precedence.
4. **Self-Modification**: Agents are empowered to create, edit, and refine their own skills using standard file tools (`write_file`, `edit_file`).

## Consequences
### Positive
- Baseline system prompt token overhead reduced by ~85%, saving context window space for actual task reasoning.
- Unlimited skill extensibility: Users and agents can author new skills without restarting the application or modifying system prompts.
- Clear structural validation on `name` (regex `^[a-z0-9]+(-[a-z0-9]+)*$`), `description` (max 1024 chars), and file size (<10MB).

### Negative / Trade-offs
- Adds one tool-call turn when the agent needs to fetch a new skill before execution.

## Compliance
Verified via `src/collaragent/middleware/skills.ts` and `src/collaragent/skills/loader.ts`.
