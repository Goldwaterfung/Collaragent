# ADR-006: Large Tool Output Eviction Protocol

## Status
**Accepted**

## Context
When an AI agent invokes tools that scan repositories or read large data files (e.g. `grep`, `glob`, `read_file`, `internet_search`), tool results can easily reach several megabytes or tens of thousands of tokens. Returning such massive payloads directly inside a `ToolMessage` risks exceeding provider context window boundaries, degrading reasoning performance, or triggering API errors.

## Decision
We implement automated **Large Tool Output Eviction** inside `FilesystemMiddleware`:
1. **Eviction Threshold**: Evaluates the character and token length of tool outputs against `toolTokenLimitBeforeEvict` (default: 20,000 tokens / ~80KB).
2. **File Storage Redirection**: When output exceeds the limit, the full raw result is written to the virtual filesystem backend under `/large_tool_results/{sanitized_tool_call_id}`.
3. **Payload Truncation**: The `ToolMessage` content injected back into the LLM context is replaced with a formatted head/tail preview (first 10 and last 5 lines) along with an explicit instruction:
   ```markdown
   Tool output was too large (24,500 tokens) and was evicted to:
   /large_tool_results/call_abc123.txt
   Use `read_file` with offset/limit parameters to read specific slices.
   ```
4. **Exceptions**: Tools with self-contained internal pagination (such as `ls` or `read_file` with `offset`/`limit`) bypass eviction to prevent redundant double-writing.

## Consequences
### Positive
- Strict protection against context window exhaustion and accidental API crashes.
- Empowers the agent to iteratively read large file contents using offsets rather than choking on a single massive prompt.

### Negative / Trade-offs
- Adds an intermediate virtual file in the storage backend.

## Compliance
Verified via `src/collaragent/middleware/fs.ts`.
