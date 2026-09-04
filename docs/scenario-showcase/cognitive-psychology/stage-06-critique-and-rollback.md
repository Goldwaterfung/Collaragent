# Stage 6: Critique, Invariant Verification & Reversible Rollback

## Scenario Overview

- **Scenario ID**: `SCN-PSY-06`
- **Domain**: Cognitive Psychology
- **Lifecycle Stage**: 6 (Critique, Invariant Verification & Reversible Rollback)
- **Primary Objective**: Demonstrate scientific peer critique, defect identification, and non-destructive mathematical rollback. When a speculative, ungrounded physiological claim (pupillometry) is mistakenly introduced into the methodology, the researcher rejects the proposal. The runtime's [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts) inverts the command stream, restoring the pristine document state with 100% byte-level snapshot parity.
- **Participating Agent**: DeepAgent interacting with [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts) and [`AssertionEngine`](file:///Users/goldenfung/Documents/collaragent/evals/assertions/AssertionEngine.ts#L22).
- **Workspace Tools & Runtime Engines**: [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820), `InverseCommandEngine.invert()`, `assertRollbackParity()`.

---

## 1. The Collaborative Scientific Crisis: Ungrounded Claim Insertion

During a fast-paced co-authoring iteration, an agent sub-routine attempts to expand the methodology by adding an uncalibrated biometric measure to the apparatus:

```json
{
  "command": "insertBlock",
  "targetSection": "Apparatus & Secondary Probe Task",
  "content": {
    "type": "paragraph",
    "children": [
      {
        "text": "In addition to the foot pedal, continuous cognitive load is indexed using a Tobii Pro Fusion eye-tracker sampling at 250 Hz. Pupillary dilation is assumed to directly reflect germane schema construction load independent of display luminance."
      }
    ]
  }
}
```

---

## 2. Human Researcher Peer Critique

The human researcher immediately catches the methodological flaw:

```markdown
User:
Stop! This edit introduces a severe threat to internal validity.
Pupillometry is notorious for confounding cognitive effort with the Light Reflex (pupillary constriction due to screen luminance shifts during pane transitions). Since participants switch between the white concept canvas and the white text editor, luminance fluctuations will produce pupil artifacts that dwarf cognitive load signals.

I reject this proposal completely. Roll back this entire edit and restore the document to its exact pre-proposal state. Prove that no ghost artifacts or corrupted block IDs remain.
```

---

## 3. Runtime Reversibility: The Inverse Command Engine

Unlike naive text editors that simply perform unmonitored "undo" or re-parse markdown (which often re-generates new random node IDs or mutates whitespace), CollarAgent uses a deterministic **mathematical command inversion engine** ([`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts)):

$$\text{State Transition: } S_0 \xrightarrow{\text{Command } C} S_1 \xrightarrow{\text{Inverse } C^{-1}} S_0$$

### Mathematical Inversion Table:

| Forward Command ($C$) | Forward Parameters                                        | Mathematical Inverse ($C^{-1}$) | Inverted Parameters                                       |
| :-------------------- | :-------------------------------------------------------- | :------------------------------ | :-------------------------------------------------------- |
| `insertBlock`         | `{ blockId: "b-pupil-99", index: 4, payload: [...] }`     | `deleteBlock`                   | `{ blockId: "b-pupil-99", index: 4 }`                     |
| `updateBlockText`     | `{ blockId: "b-method-1", oldText: "T1", newText: "T2" }` | `updateBlockText`               | `{ blockId: "b-method-1", oldText: "T2", newText: "T1" }` |
| `insertRelationship`  | `{ source: "TobiiPro", target: "GermaneLoad" }`           | `deleteRelationship`            | `{ relationshipId: "rel-tobii-01" }`                      |

### Inversion Execution Log:

```typescript
// InverseCommandEngine.ts execution
const forwardCommands = [
  { type: 'INSERT_BLOCK', index: 4, block: pupilBlockPayload },
  { type: 'LINK_CANVAS_NODE', source: 'Canvas_Pupil', target: 'CLT_Germane' }
]

// Generate exact inverse command stream
const inverseCommands = InverseCommandEngine.invert(forwardCommands)
// Results in:
// [
//   { type: 'UNLINK_CANVAS_NODE', source: 'Canvas_Pupil', target: 'CLT_Germane' },
//   { type: 'DELETE_BLOCK', index: 4, blockId: 'b-pupil-99' }
// ]

// Execute inverted stream
await executeDocumentCommands('Cognitive_Psychology_Manuscript_Draft', inverseCommands)
```

---

## 4. Invariant Verification: 100% Snapshot Byte Parity

To ensure that no invisible metadata rot or AST corruption occurred, [`AssertionEngine.assertRollbackParity`](file:///Users/goldenfung/Documents/collaragent/evals/assertions/AssertionEngine.ts#L162) computes a cryptographic hash comparison between the baseline snapshot $S_0$ and the restored snapshot $S_0'$:

```typescript
// AssertionEngine evaluation
const parityResult = AssertionEngine.assertRollbackParity(initialSnapshot, restoredSnapshot)

console.log(parityResult)
// {
//   matches: true,
//   byteParity: true,
//   diffSummary: "0 bytes changed, 0 keys altered, 0 dangling references",
//   errors: []
// }
```

| Verification Parameter | Baseline Snapshot ($S_0$)             | Restored Snapshot ($S_0'$)            | Status             |
| :--------------------- | :------------------------------------ | :------------------------------------ | :----------------- |
| **Total AST Blocks**   | 12                                    | 12                                    | **Match**          |
| **Document SHA-256**   | `e3b0c44298fc1c149afbf4c8996fb924...` | `e3b0c44298fc1c149afbf4c8996fb924...` | **100% Identical** |
| **Canvas DAG Nodes**   | 16                                    | 16                                    | **Match**          |
| **Canvas DAG Edges**   | 19                                    | 19                                    | **Match**          |
| **Dangling Endpoints** | 0                                     | 0                                     | **Clean**          |

---

## 5. Scientific Research Takeaway

This stage exemplifies why **reversibility and staged diffs are critical for academic co-working**:

1. **Psychological Safety for the Researcher**: The researcher can allow the agent to propose bold theoretical leaps, knowing that any ungrounded claim can be reverted mathematically with zero residual damage to the manuscript.
2. **Methodological Rigor**: Peer critique can be operationalized immediately. Uncontrolled variables are purged cleanly without leaving orphan citations or broken cross-references.
3. **Reproducibility**: The entire trial history (forward proposal, critique, and inverse rollback) is preserved in structured audit logs, ensuring transparency for open-science reproducibility packages.
