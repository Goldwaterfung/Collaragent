# Stage 6: Critique, Invariant Verification & Reversible Rollback

## Scenario Overview

- **Scenario ID**: `SCN-ACO-06`
- **Domain**: Psychoacoustics & Auditory Perception
- **Lifecycle Stage**: 6 (Critique, Invariant Verification & Reversible Rollback)
- **Primary Objective**: Demonstrate scientific peer review, acoustic defect detection, and deterministic state reversibility. When an automated agent proposal inserts an uncontrolled minimum-phase IIR equalization filter that compromises interaural phase integrity, the researcher rejects the change. CollarAgent's [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts) mathematically reverses the patch commands, guaranteeing 100% snapshot byte parity with the pristine baseline.
- **Participating Agent**: DeepAgent interacting with [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts) and [`AssertionEngine`](file:///Users/goldenfung/Documents/collaragent/evals/assertions/AssertionEngine.ts#L22).
- **Workspace Tools & Runtime Engines**: [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820), `InverseCommandEngine.invert()`, `assertRollbackParity()`.

---

## 1. The Collaborative Scientific Crisis: Phase-Distorting Filter Proposal

During an automated signal processing optimization pass, an agent proposes modifying the headphone calibration pipeline in the methodology:

```json
{
  "command": "insertBlock",
  "targetSection": "Apparatus & Signal Processing Chain",
  "content": {
    "type": "paragraph",
    "children": [
      {
        "text": "To flatten headphone frequency response, an 8th-order recursive minimum-phase IIR filter is inserted directly post-convolver, sharply notching resonance at 9.2 kHz."
      }
    ]
  }
}
```

---

## 2. Human Researcher Scientific Critique

The researcher immediately identifies that this proposal would corrupt the experimental baseline:

```markdown
User:
Reject this edit immediately!
An 8th-order minimum-phase IIR filter introduces severe non-linear group delay across the spectrum.
In spatial audio, Interaural Time Differences (ITD) below 1.5 kHz require microsecond-precise phase coherence
(tolerance < 10 microseconds). A minimum-phase notch will smear interaural cross-correlation (IACC),
artificially inflating soundstage width and invalidating our baseline latency calibration.

Revert this modification entirely. Restore the document to the pristine baseline and verify
that no lingering filter parameters remain in the document AST or project snapshot.
```

---

## 3. Mathematical Command Inversion via `InverseCommandEngine`

Instead of relying on lossy text re-parsing, CollarAgent's [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts) generates the formal algebraic inverse of the forward command sequence:

$$S_0 \xrightarrow{\text{Forward Command Stream } \vec{C}} S_1 \xrightarrow{\text{Inverse Stream } \vec{C}^{-1}} S_0$$

### Command Stream Inversion:

```typescript
// Forward commands proposed during optimization
const forwardCommands = [
  {
    type: 'INSERT_BLOCK',
    index: 3,
    blockId: 'b-iir-filter-01',
    payload: {
      type: 'paragraph',
      children: [
        {
          text: 'To flatten headphone frequency response, an 8th-order recursive minimum-phase IIR filter...'
        }
      ]
    }
  },
  {
    type: 'LINK_CANVAS_NODE',
    relationshipId: 'rel-dsp-eq-01',
    source: 'DSP_Binaural',
    target: 'ANAT_Pinna',
    label: 'notched via IIR'
  }
]

// InverseCommandEngine computes the exact inverse sequence
const inverseCommands = InverseCommandEngine.invert(forwardCommands)
// Output:
// [
//   { type: 'UNLINK_CANVAS_NODE', relationshipId: 'rel-dsp-eq-01' },
//   { type: 'DELETE_BLOCK', index: 3, blockId: 'b-iir-filter-01' }
// ]

// Apply inverted commands to restore pristine state
await executeDocumentCommands('Psychoacoustics_Manuscript_Draft', inverseCommands)
```

---

## 4. Invariant Verification: 100% Snapshot Byte Parity

[`AssertionEngine.assertRollbackParity`](file:///Users/goldenfung/Documents/collaragent/evals/assertions/AssertionEngine.ts#L162) evaluates the restored state against the pre-proposal snapshot $S_0$:

```typescript
const parityResult = AssertionEngine.assertRollbackParity(preProposalSnapshot, restoredSnapshot)

console.log(parityResult)
// {
//   matches: true,
//   byteParity: true,
//   diffSummary: "0 bytes changed, 0 keys altered, 0 dangling references",
//   errors: []
// }
```

| Verification Audit Check    | Pre-Proposal Baseline ($S_0$) | Post-Rollback Restored ($S_0'$) | Parity Status        |
| :-------------------------- | :---------------------------- | :------------------------------ | :------------------- |
| **Total Manuscript Blocks** | 18                            | 18                              | **Exact Match**      |
| **Document State SHA-256**  | `4f8a29b01c38e9...`           | `4f8a29b01c38e9...`             | **100% Byte Parity** |
| **Canvas Graph Nodes**      | 17                            | 17                              | **Exact Match**      |
| **Canvas Graph Edges**      | 22                            | 22                              | **Exact Match**      |
| **Dangling Relationships**  | 0                             | 0                               | **Clean Invariant**  |

---

## 5. Scientific Research Takeaway

1. **Acoustic Integrity Preserved**: Physical acoustic cues (ITD phase coherence) are protected from accidental degradation during high-speed AI co-authoring.
2. **Defensible Methodology**: The researcher can test exploratory DSP configurations knowing that any proposal introducing phase or temporal distortion can be completely rolled back without trace contamination.
3. **Audit Trail for Open Science**: The rejected proposal and its mathematical inversion are preserved in the experiment's event log, providing full provenance for reproducibility reporting.
