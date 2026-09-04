---
name: research-stage-6-critique-rollback
description: Multi-agent scientific peer review critique, defect detection, and mathematical reversibility skill. Adversarially reviews methodology, catches ungrounded claims or stale state collisions, and executes mathematical command stream inversion with 100% snapshot byte parity using subagents.
---

# Research Stage 6: Scientific Critique, Verification & Reversible Rollback

Stage 6 multi-agent orchestration skill for conducting adversarial peer review, detecting ungrounded scientific claims or concurrent co-authoring race conditions, and executing mathematical command stream inversion with 100% snapshot byte parity in the CollarAgent workspace.

---

## When to Use This Skill

- Performing an adversarial peer review audit on a completed manuscript or methodology draft.
- Detecting ungrounded assertions, confounding variables, or phase/timing distortions before submission.
- Resolving concurrent co-authoring conflicts where a human researcher edited a document while an agent generated a proposal.
- Executing deterministic, zero-data-loss mathematical rollbacks of rejected proposals.

---

## Integrated Foundation Skills

This stage integrates and operationalizes principles from:

- **`focused-execution-specialist`**:
  - Enforces fearless, adversarial critique; identifies weak assumptions, statistical overreach, and validity threats without hesitation.
  - Implements deterministic, algebraic inverse operations with surgical precision and zero scope drift.
- **`holistic-thinking-analyst`**:
  - Traces system-wide second-order effects of proposed changes across the visual Concept Canvas and Lexical document workspace.

---

## Multi-Agent Subagent Worker Topology

The Stage 6 Orchestrator coordinates four specialized subagent workers:

```
                    [Stage 6 Critique & Rollback Orchestrator]
                                        │
    ┌───────────────────────────────────┼───────────────────────────────────┐
    ▼                                   ▼                                   ▼
[Subagent 1: Peer Reviewer]  [Subagent 2: Collision Guard]   [Subagent 3: Rollback Executor]
(Adversarial Validity Audit)  (Parent Hash Conflict Check)    (Algebraic Command Inversion)
                                                                            │
                                                                            ▼
                                                                [Subagent 4: Rebase Integrator]
                                                                (Clean Merge onto Human Edits)
```

### Worker Roles & Delegation Contracts

| Subagent Worker Role              | Responsibility                                                                                                    | Input Contract                                             | Expected Deliverable                                                       |
| :-------------------------------- | :---------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------- |
| **`adversarial-peer-reviewer`**   | Rigorously audits drafts for threats to internal/external validity, confounding variables, and ungrounded claims. | `Manuscript_Draft` and `Methodology_Protocol`.             | Structured Peer Review Critique Report with specific line/block citations. |
| **`concurrency-collision-guard`** | Intercepts parent snapshot hash mismatches to prevent overwriting concurrent human edits.                         | Document snapshot history and incoming patch proposal.     | Concurrency audit status: `CLEAN` or `STALE_PARENT_HASH`.                  |
| **`inverse-rollback-executor`**   | Computes exact algebraic inverse operations for rejected proposals and restores baseline state.                   | Forward patch operations list and pre-patch snapshot hash. | Executed `editDocument` inverse operations stream with 100% byte parity.   |
| **`rebase-integrator`**           | Re-bases valid agent suggestions onto live human text when parent hash is stale, preserving all human keystrokes. | Live document state and agent proposal.                    | Re-based, non-conflicting patch operations list.                           |

---

## Mathematical Command Inversion Algebra

CollarAgent enforces deterministic reversibility through mathematical command inversion. Every forward operation $C$ maps to an exact algebraic inverse $C^{-1}$ such that $S \circ C \circ C^{-1} = S$:

| Forward Operation ($C$)            | Inverse Operation ($C^{-1}$)               | Pre-Conditions Required                                                       |
| :--------------------------------- | :----------------------------------------- | :---------------------------------------------------------------------------- |
| `insert(blockId, anchor, newHtml)` | `delete(newBlockId)`                       | `newBlockId` generated during insertion is retained in transaction receipt.   |
| `update(blockId, newHtml)`         | `update(blockId, oldHtml)`                 | Baseline `oldHtml` captured via `readDocument` before applying update.        |
| `delete(blockId)`                  | `insert(adjacentBlockId, anchor, oldHtml)` | Complete deleted block `oldHtml` and anchor position recorded in undo buffer. |

Applying the inverse sequence in reverse order ($C_n^{-1}, C_{n-1}^{-1}, \dots, C_1^{-1}$) restores the exact binary snapshot without relying on destructive state wipes.

---

## Step-by-Step Multi-Agent Execution Protocol

### Step 1: Adversarial Peer Review Audit (`adversarial-peer-reviewer`)

1. Ingest `Manuscript_Draft` using `readDocument`.
2. Evaluate draft against four critical validity axes:
   - **Internal Validity**: Are there confounding variables or instrumentation flaws? (e.g. using a minimum-phase IIR filter that introduces nonlinear phase distortion into binaural audio).
   - **Construct Validity**: Are the operationalized metrics true representations of the theoretical construct?
   - **Statistical Conclusion Validity**: Are power assumptions, test selections, and alpha corrections appropriate?
   - **Empirical Grounding**: Is every factual claim directly corroborated by a verified reference from Stage 2?

### Step 2: Concurrency & Parent Hash Verification (`concurrency-collision-guard`)

1. Retrieve live document state using `readDocument`.
2. Verify that the current document block IDs and text content match the state the agent based its proposal upon.
3. If human researcher keystrokes have altered the target block while the agent was processing, flag a `STALE_PARENT_HASH` collision.

### Step 3: Proposal Rejection & Rollback Execution (`inverse-rollback-executor`)

If a proposal contains scientific defects or was rejected by the human researcher:

1. Synthesize the exact inverse command stream using the inversion algebra.
2. Invoke `editDocument` with the inverse operations array.
3. Verify that the resulting document snapshot hash matches the pre-edit baseline with **100% byte parity**.

### Step 4: Non-Destructive Re-base (`rebase-integrator`)

If an agent suggestion is scientifically valid but collided with concurrent human edits:

1. Extract the human's newly inserted text blocks.
2. Shift proposal anchor block IDs to target only unedited sections.
3. Apply the re-based patch via `editDocument` without overwriting human keystrokes.

### Step 5: Final Milestone Gate Verification

Present the peer review audit and reversibility log to the human researcher for final milestone acceptance.

---

## Workspace Tool Call Signatures & Examples

### 1. Read Current State for Audit (`readDocument`)

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace"
}
```

### 2. Forward Operation Introducing a Defective Block (Scenario Trace)

_Subagent mistakenly inserts an ungrounded pupillometry claim without apparatus calibration:_

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace",
  "operations": [
    {
      "action": "insert",
      "blockId": "b_method_procedure",
      "anchor": "after",
      "newHtml": "<p id=\"b_defective_pupil\">Continuous pupillometry was recorded at 60 Hz to index autonomic cognitive arousal without infrared luminance calibration.</p>"
    }
  ],
  "explanation": "Add pupillometry cognitive arousal measure"
}
```

### 3. Executing Mathematical Inverse Rollback (`editDocument`)

_Adversarial reviewer flags lack of luminance calibration (severe confounder). Orchestrator triggers exact inverse rollback:_

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace",
  "operations": [
    {
      "action": "delete",
      "blockId": "b_defective_pupil"
    }
  ],
  "explanation": "Rollback ungrounded pupillometry block: uncalibrated luminance introduces severe confound to pupil diameter metrics"
}
```

### 4. Verified Post-Rollback State Audit (`readDocument`)

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace"
}
```

---

## Error Handling & Invariant Rules

1. **100% Snapshot Byte Parity Invariant**:
   - Following an inverse rollback, the document AST must match the baseline snapshot with 100% byte parity. Zero residual formatting drift or orphaned tags are permitted.
2. **Human Primacy Invariant**:
   - Under concurrent editing collisions, human edits ALWAYS take precedence. DeepAgent must never overwrite human text without an explicit re-base and user approval.
3. **Audit Trail Invariant**:
   - Every proposal rejection and inverse rollback must be documented with an explicit scientific rationale in the `explanation` parameter of `editDocument`.

---

## Stage 6 Gate Exit Checklist

Before concluding the research lifecycle:

- [ ] Adversarial peer review audit completed across all validity axes.
- [ ] Concurrency collisions checked against live document state.
- [ ] Defective or ungrounded proposals rejected and inverted with 100% snapshot byte parity.
- [ ] Valid proposals re-based cleanly without overwriting human text.
- [ ] Final manuscript draft verified as publication-grade.
- [ ] Human researcher signs off on the final research package.
