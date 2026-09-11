Searched for "contextEditingMiddleware"
Viewed constants.ts:30-60
Viewed PatchCommandEngine.ts:1-100
Viewed PatchCommandEngine.ts:95-135

To significantly improve token context efficiency **without sacrificing tool use accuracy**, we need to address where the tokens are actually being wasted: **coarse reading**, **full-block retransmission**, **catastrophic error dumps**, and **stale tool-argument accumulation**.

Here are 4 concrete, pragmatic architectural recommendations:

---

### 1. Optimize Document Discovery & Reading ([`readDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L1210-L1233))

Currently, to find a single `blockId` to edit, the model must invoke [`readDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L745-L823), which returns up to **50 blocks of raw HTML** ([`DEFAULT_DOCUMENT_BLOCK_LIMIT = 50`](file:///Users/goldenfung/Documents/collaragent/src/shared/constants.ts#L43)), injecting 4,000–10,000 tokens into the trajectory.

Viewed improve-workspace-tool-token.md:1-100
Viewed improve-workspace-tool-token.md:90-101

Here is a detailed breakdown of **Recommendation 1: Optimize Document Discovery & Reading**, analyzing how **1A**, **1B**, and **1C** work, why they maintain high accuracy, and how they collectively solve the context-bloat problem.

---

### Current Codebase Bottleneck

In [`src/collaragent/tools/WorkspaceTools.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L773-L784), [`readDocumentHandler`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L745-L823) currently uses coarse pagination:

```typescript
const offset = Math.max(0, Math.min(input.offset ?? 0, totalBlocks))
const limit = Math.max(
  1,
  Math.min(input.limit ?? DEFAULT_DOCUMENT_BLOCK_LIMIT, MAX_DOCUMENT_BLOCK_LIMIT)
)
const slicedBlocks = allBlocks.slice(offset, offset + limit)
const editableBlocks = buildEditableBlocks(slicedBlocks)
```

Because [`DEFAULT_DOCUMENT_BLOCK_LIMIT = 50`](file:///Users/goldenfung/Documents/collaragent/src/shared/constants.ts#L43), every unconstrained read returns **50 full HTML blocks** (often 4,000–8,000 words with table markups and attributes). When an agent only needs to locate a section or retrieve a single block ID to edit, this dumps thousands of tokens of irrelevant text into the conversation history.

---

### Recommendation 1A: Add an `outlineOnly` Mode

#### 1. How It Works

We extend [`getDocumentInputSchema`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L111-L141) with an optional flag:

```typescript
outlineOnly: z.boolean()
  .optional()
  .describe(
    'If true, returns only headings and compact block previews with IDs. Highly token-efficient for understanding structure and finding block IDs.'
  )
```

When `outlineOnly: true`, [`readDocumentHandler`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L745-L823) does not serialize full HTML for all blocks. Instead, it iterates through `payload.blocks`:

- **Headings (`h1`–`h4`)**: Retained in full text to show the hierarchy.
- **Content blocks (`p`, `table`, `ul`, `code`)**: Only the first ~50 characters are extracted as a `preview` string.
- **Output format**:
  ```json
  {
    "status": "success",
    "action": "Read Outline",
    "totalBlocks": 65,
    "outline": [
      { "id": "b1", "type": "h1", "text": "1. Introduction" },
      { "id": "b2", "type": "paragraph", "preview": "In this paper, we explore multi-agent..." },
      { "id": "b6", "type": "h2", "text": "2. Experimental Methodology" },
      { "id": "b7", "type": "table", "preview": "[Table: 4 rows x 3 columns]" },
      { "id": "b8", "type": "paragraph", "preview": "The baseline configuration relies on..." }
    ]
  }
  ```

#### 2. Accuracy & Token Impact

- **Token Reduction**: A 70-block document outline costs **~350–500 tokens** instead of **7,000–10,000 tokens** (**>90% savings**).
- **Accuracy Preserved**: The model receives the exact persistent `id` for every block and a clear map of the document's structure, eliminating "blind guessing" of block IDs.

---

### Recommendation 1B: Targeted Radius Reading (`targetBlockId` + `radius`)

#### 1. How It Works

Currently, the model only has `offset` and `limit`. To read block `b12`, the model has to guess what offset `b12` is at, or read from offset 0 and receive 49 other blocks.

We add targeted anchor parameters to [`getDocumentInputSchema`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L111-L141):

```typescript
targetBlockId: z.string().optional().describe(
  'Target block ID to anchor reading around. Fetches this block and immediate surrounding context.'
),
radius: z.number().int().min(0).max(5).optional().default(2).describe(
  'Number of context blocks before and after targetBlockId to include (default: 2).'
)
```

In [`readDocumentHandler`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L745-L823):

```typescript
if (input.targetBlockId) {
  const targetIdx = allBlocks.findIndex((b) => b.id === input.targetBlockId)
  if (targetIdx === -1) {
    throw new WorkspaceToolError(
      `Target block "${input.targetBlockId}" not found in document.`,
      WorkspaceErrorCode.WORKSPACE_BLOCK_IDENTITY_MISSING
    )
  }
  const start = Math.max(0, targetIdx - (input.radius ?? 2))
  const end = Math.min(totalBlocks, targetIdx + (input.radius ?? 2) + 1)
  slicedBlocks = allBlocks.slice(start, end)
}
```

#### 2. Accuracy & Token Impact

- **Token Reduction**: Returns only 3–5 blocks (**~300–600 tokens**) instead of 50 blocks.
- **Accuracy Improved**: By delivering the exact target block and its immediate neighbors (radius ±2), the model has the exact surrounding context needed to generate valid patch HTML without hallucinating or losing thread continuity.

---

### Recommendation 1C: Reduce `DEFAULT_DOCUMENT_BLOCK_LIMIT`

#### 1. How It Works

In [`src/shared/constants.ts`](file:///Users/goldenfung/Documents/collaragent/src/shared/constants.ts#L43):

```typescript
// Change from 50 to 15 or 20
export const DEFAULT_DOCUMENT_BLOCK_LIMIT = 15
export const MAX_DOCUMENT_BLOCK_LIMIT = 200
```

#### 2. Rationale

- **50 blocks is too large for a default**: 50 academic blocks typically represent 3,500–6,000 words. A default should cover a coherent reading unit—such as 1 to 2 subsections—not an entire manuscript.
- **15 blocks**: Covers approximately 1,000–1,500 words, which is ideal for a focused LLM reasoning window.
- **Flexibility preserved**: If an agent genuinely needs a larger window (e.g. for a global structural review), it can still explicitly request `limit: 50` or `limit: 100` up to `MAX_DOCUMENT_BLOCK_LIMIT`.

---

### The Unified Workflow: How 1A, 1B, and 1C Work Together

By combining these three improvements, the agent switches from a brute-force reading model to an indexed retrieval model:

```
[Agent needs to update a hypothesis in Section 2]
                     │
                     ▼
Step 1: readDocument({ instanceName: "Spec", outlineOnly: true })
        ↳ Returns outline (~400 tokens) -> Agent spots target block "h2_hypo_3"
                     │
                     ▼
Step 2: readDocument({ instanceName: "Spec", targetBlockId: "h2_hypo_3", radius: 1 })
        ↳ Returns 3 blocks (~350 tokens) -> Agent inspects exact wording
                     │
                     ▼
Step 3: editDocument({ operations: [{ action: "update", blockId: "h2_hypo_3", newHtml: "..." }] })
        ↳ Returns diff snippet (~200 tokens)
```

- **Total context consumed across the full workflow**: **~950 tokens** (compared to **~10,000+ tokens** under the current 50-block baseline).
- **Tool accuracy**: Actually **higher**, because the model is never distracted by 40+ unrelated paragraphs when drafting its patch.

---

### 2. Localize Fallbacks on Edit Failure ([`editDocumentHandler`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L946-L960))

In [`src/collaragent/tools/WorkspaceTools.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L946-L960), when [`PatchCommandEngine.compile`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L82) fails to apply a patch (`!compiled.applied`), the handler returns:

```typescript
if (!compiled.applied) {
  return {
    status: 'error',
    action: 'Failed to edit',
    instanceId: resolved.instanceId,
    instanceName: resolved.name,
    projectName: input.projectName,
    explanation: input.explanation,
    code: compiled.code,
    message: compiled.message,
    recommendFix: getRecommendFix(compiled.message),
    failedHunk: compiled.hunkIndex,
    current_editable_blocks: buildEditableBlocks(payload.blocks) // <-- The Bottleneck
  }
}
```

#### Why this causes a context explosion:

1. **Unconstrained Document Dump**:
   [`buildEditableBlocks(payload.blocks)`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L496-L527) serializes **every single block of the entire document** in full HTML. For an 80-block document, a single mistyped `blockId` dumps **8,000–15,000 tokens** into the conversation history.
2. **Compound Errors**:
   If the model makes two consecutive patch mistakes (e.g. failing on block A, then retrying and failing on block B), **20,000–30,000 tokens** are consumed by error payloads alone.
3. **Bypasses Eviction**:
   As established in [`src/collaragent/middleware/filesystem.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/middleware/filesystem.ts#L22-L27), workspace tools bypass large-result disk eviction, meaning the entire dump permanently resides in active model context.
4. **Waste on Parameter Errors**:
   If the patch failed because `newHtml` was missing or empty ([`PatchCommandEngine.ts:L108-L115`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L108-L115)), the block ID was actually valid! Dumping the entire document in this scenario is 100% redundant.

---

### The Solution: Localized, Tiered Fallbacks

Instead of an unconditional full-document dump, the fallback should be **tiered based on the failure type**:

```
                       Patch Compilation Failed
                                  │
         ┌────────────────────────┴────────────────────────┐
         ▼                                                 ▼
Case A: Syntax/Param Error                       Case B: Block ID Mismatch
(`newHtml` missing, invalid tag)                 (`PATCH_CONTEXT_MISMATCH`)
         │                                                 │
         ▼                                                 ▼
Return NO blocks                                 Return Targeted Diagnostics:
(Only `code`, `message`, `failedHunk`)           1. Failed blockId & operation index
Token cost: ~80 tokens                           2. Closest matching block IDs
                                                 3. Compact Outline (IDs + headers only)
                                                 Token cost: ~350 tokens
```

---

### Implementation Details

#### 1. Eliminate Blocks on Parameter/Syntax Errors

When [`compiled.code !== 'PATCH_CONTEXT_MISMATCH'`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L102), the error is purely syntactic (e.g. missing `newHtml` or missing `anchor` on `insert`).

- **Action**: Do not return any blocks.
- **Payload**: Only return `status: 'error'`, `code`, `message`, `failedHunk`, and [`getRecommendFix(message)`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L567-L581).
- **Savings**: **100% of the block dump is avoided** (~8,000+ tokens saved).

#### 2. Compact Structural Outline on Missing Block IDs

When a block ID is not found ([`code: 'PATCH_CONTEXT_MISMATCH'`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L102)), the model needs to know what the valid block IDs actually are.
Instead of returning full HTML blocks, return a **compact recovery outline**:

```typescript
interface BlockRecoveryHint {
  id: string
  type: string
  preview: string // max 40 chars
}
```

Example error response sent to the model:

```json
{
  "status": "error",
  "action": "Failed to edit",
  "code": "PATCH_CONTEXT_MISMATCH",
  "message": "Could not find block \"sec_methods_99\" for update (Operation index 0).",
  "failedHunk": 0,
  "failedBlockId": "sec_methods_99",
  "recommendFix": "Re-run readDocument or select a valid block ID from valid_outline below.",
  "valid_outline": [
    { "id": "b1", "type": "h1", "preview": "1. Introduction" },
    { "id": "b2", "type": "paragraph", "preview": "Recent advancements in multi-agent..." },
    { "id": "b5", "type": "h2", "preview": "2. Methodology" },
    { "id": "b6", "type": "paragraph", "preview": "We designed our benchmarks around..." }
  ]
}
```

#### 3. Proximity Window (If Batched Operations Succeeded)

If an edit call contains 3 operations, and operation 0 on block `b5` succeeded, but operation 1 on block `b_unknown` failed:

- The handler can slice only the blocks immediately following `b5` (e.g. `b5`, `b6`, `b7`).
- The model immediately sees the exact neighborhood where it was operating.

---

### Comparison: Current vs. Localized Fallback

| Metric                       | Current Implementation                                | Localized Fallback Design                                                     |
| :--------------------------- | :---------------------------------------------------- | :---------------------------------------------------------------------------- |
| **Payload on Syntax Error**  | Full document (~8,000–12,000 tokens)                  | Error message only (**~80 tokens**)                                           |
| **Payload on Missing Block** | Full document (~8,000–12,000 tokens)                  | Compact outline / proximity window (**~350 tokens**)                          |
| **Two Consecutive Errors**   | ~20,000+ tokens                                       | **< 800 tokens**                                                              |
| **Model Recovery Accuracy**  | Moderate (model often gets lost in 80 blocks of HTML) | **Higher** (clean list of IDs and headers directly pinpointing valid targets) |

---

### 3. Support In-Block String Replacement in [`PatchCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L77-L135)

Viewed PatchCommandEngine.ts:1-150

### 1. The Core Concept in [`PatchCommandEngine.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L78-L136)

Currently, [`PatchCommandEngine.compile`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L82) only understands three coarse block-level operations:

1. `update`: Replaces the **entire block** with `newHtml`.
2. `insert`: Inserts new blocks before/after an anchor block.
3. `delete`: Deletes a block.

#### The Inefficiency of `update`:

In lines 112–120:

```typescript
const newBlocks = htmlToBlocks(op.newHtml)
// ...
const firstBlock = newBlocks[0]
firstBlock.id = op.blockId
const { id: _id, ...changes } = firstBlock
commands.push({ type: 'editor:update_block', blockId: op.blockId, changes })
```

If an agent needs to fix a single typo, update a parameter, or modify one sentence in a 350-word paragraph (or a 15-row table), `update` forces the model to regenerate the **entire 350-word paragraph in `newHtml`**.

#### The `replace_text` Solution:

Instead of replacing the block, `replace_text` performs a surgical substring replacement within the target block:

1. Locate the block by `op.blockId` in `workingLines[index]`.
2. Verify that `op.target` exists in the block's current content. If missing, fail fast with `PATCH_CONTEXT_MISMATCH`.
3. Replace `op.target` with `op.replacement`.
4. Parse the resulting string back into a block AST via `htmlToBlocks` and emit the exact same atomic [`editor:update_block`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L147) command.

---

### 2. How `PatchCommandEngine` Implements `replace_text`

Inside [`PatchCommandEngine.compile`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L82), a new branch handles `op.action === 'replace_text'`:

```typescript
if (op.action === 'replace_text') {
  const index = findBlockIndex(workingLines, op.blockId)
  if (index === -1) {
    return {
      applied: false,
      code: 'PATCH_CONTEXT_MISMATCH',
      message: `Could not find block ${op.blockId} for replace_text (Operation index ${i}).`,
      hunkIndex: i
    }
  }

  if (!op.target || op.replacement === undefined) {
    throw new Error(
      `Operation ${i}: both "target" and "replacement" are required for replace_text.`
    )
  }

  const currentBlockLine = workingLines[index]
  if (!currentBlockLine.includes(op.target)) {
    return {
      applied: false,
      code: 'PATCH_CONTEXT_MISMATCH',
      message: `Target text "${op.target}" was not found in block ${op.blockId} (Operation index ${i}).`,
      hunkIndex: i
    }
  }

  // Perform surgical replacement on the block HTML
  const updatedBlockLine = currentBlockLine.replace(op.target, op.replacement)
  const newBlocks = htmlToBlocks(updatedBlockLine)
  const updatedBlock = newBlocks[0]
  updatedBlock.id = op.blockId

  const { id: _id, ...changes } = updatedBlock
  commands.push({ type: 'editor:update_block', blockId: op.blockId, changes })
  workingLines[index] = serializeBlock(updatedBlock)
  blocksUpdated++
  continue
}
```

---

### 3. Updated Schema in [`WorkspaceTools.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts)

#### A. Updated [`PatchOperation`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L8-L13) Type

In [`src/collaragent/runtime/PatchCommandEngine.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L8-L13):

```typescript
export interface PatchOperation {
  action: 'update' | 'insert' | 'delete' | 'replace_text'
  blockId: string
  anchor?: 'before' | 'after'
  newHtml?: string
  target?: string // Required when action is 'replace_text'
  replacement?: string // Required when action is 'replace_text'
}
```

#### B. Updated [`editDocumentSchema`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L179-L214)

In [`src/collaragent/tools/WorkspaceTools.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L179-L214), the operations array schema is extended:

```typescript
const editDocumentOperationSchema = z
  .object({
    action: z
      .enum(['update', 'insert', 'delete', 'replace_text'])
      .describe('The action to perform.'),
    blockId: z.string().describe('The target block ID (or anchor ID for insert).'),
    anchor: z
      .enum(['before', 'after'])
      .optional()
      .describe('Placement relative to blockId. Required only for "insert".'),
    newHtml: z
      .string()
      .optional()
      .describe('The new HTML content. Required for "update" and "insert".'),
    target: z
      .string()
      .optional()
      .describe('Exact substring within the block to replace. Required for "replace_text".'),
    replacement: z
      .string()
      .optional()
      .describe('Replacement string or HTML snippet. Required for "replace_text".')
  })
  .refine(
    (op) => {
      if (op.action === 'replace_text') return !!(op.target && op.replacement !== undefined)
      if (op.action === 'update') return !!op.newHtml
      if (op.action === 'insert') return !!(op.anchor && op.newHtml)
      return true
    },
    {
      message:
        'Missing required fields: "target" and "replacement" for replace_text; "newHtml" for update; "anchor" and "newHtml" for insert.'
    }
  )

const editDocumentSchema = z
  .object({
    instanceId: z.string().optional().describe('Optional persistent UUID of the document.'),
    instanceName: z.string().optional().describe('The document name.'),
    projectName: z.string().optional().describe('Optional project name.'),
    allowUnresolvedLinks: z.boolean().optional(),
    operations: z.array(editDocumentOperationSchema).min(1),
    explanation: z.string().optional()
  })
  .refine((data) => !!(data.instanceId || data.instanceName), {
    message: 'Either instanceId or instanceName must be provided.'
  })
```

#### C. Updated Tool Description for [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L1255-L1279)

In the LangChain tool registration:

```typescript
Operations:
- replace_text: Surgically replaces a specific substring within a block. Requires 'blockId', 'target', and 'replacement'. Highly recommended for minor edits, typo fixes, or metric updates (saves 90%+ tokens).
- update: Replaces the entire block at 'blockId' with 'newHtml'.
- insert: Inserts 'newHtml' 'before' or 'after' the specified 'blockId'.
- delete: Removes the block at 'blockId'.
```

---

#### Pragmatic Comparison: `update` vs. `replace_text`

Suppose an agent needs to change `p < 0.05` to `p < 0.01` in a long paragraph:

- **Using `update`**:

  ```json
  {
    "action": "update",
    "blockId": "para_results_4",
    "newHtml": "<p>Across all 120 trials, the experimental group demonstrated a statistically significant increase in retrieval accuracy (mean = 84.2%, SD = 4.1) compared to the baseline control (mean = 62.1%, SD = 5.8), with p < 0.01 under a two-tailed paired t-test. Furthermore, confidence intervals confirmed stability across repeated measures.</p>"
  }
  ```
  - **Input cost**: **~120 tokens** (all with escaped JSON quotes).
  - **Risk**: The model could accidentally drop or rephrase surrounding sentences.

- **Using `replace_text`**:
  ```json
  {
    "action": "replace_text",
    "blockId": "para_results_4",
    "target": "p < 0.05",
    "replacement": "p < 0.01"
  }
  ```
  - **Input cost**: **~20 tokens** (**83% savings** on tool call input).
  - **Risk**: **Zero hallucination / drift risk** for the rest of the block; if `target` is not found, it fails cleanly without altering anything.

---

### Summary of Impact

| Technique                     | Where to Implement                                                                                                               | Implementation Complexity | Token Savings                           | Accuracy Effect                              |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------- | :------------------------ | :-------------------------------------- | :------------------------------------------- |
| **Outline & Radius Reading**  | [`WorkspaceTools.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L111-L141)          | Low                       | **80–90%** on reads                     | Improves accuracy by reducing distraction    |
| **Localized Error Fallbacks** | [`WorkspaceTools.ts:L958`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L958)          | Low                       | **Eliminates token spikes** on failures | Neutral / identical recovery capability      |
| **In-Block `replace_text`**   | [`PatchCommandEngine.ts`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/PatchCommandEngine.ts#L97-L135) | Medium                    | **60–80%** on edit inputs               | Higher precision (no paragraph rewrite bugs) |
