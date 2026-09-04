# Stage 6: Critique, Collision Recovery & Reversible Rollback

## Scenario Overview

- **Scenario ID**: `SCN-HCI-06`
- **Domain**: Human-Computer Interaction (HCI) & Mixed-Initiative Systems
- **Lifecycle Stage**: 6 (Critique, Collision Recovery & Reversible Rollback)
- **Primary Objective**: Demonstrate optimistic concurrency control, race condition interception, and non-destructive mathematical rollback in human-AI co-authoring. When an asynchronous agent sub-routine attempts to apply an outdated patch that would overwrite live human edits, CollarAgent intercepts the conflict, inverts the corrupted patch commands via [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts), and re-bases the agent proposal onto the human's latest committed AST.
- **Participating Agent**: DeepAgent interacting with [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts) and [`AssertionEngine`](file:///Users/goldenfung/Documents/collaragent/evals/assertions/AssertionEngine.ts#L22).
- **Workspace Tools & Runtime Engines**: [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820), `InverseCommandEngine.invert()`, `assertRollbackParity()`.

---

## 1. The Collaborative Scientific Crisis: Stale State Overwrite Attempt

While the human researcher is manually editing paragraph 2 to refine the theoretical definition of _automation complacency_, an asynchronous agent subagent completes a citation-formatting task initiated 30 seconds earlier.

The agent attempts to execute an outdated patch targeting paragraph 2 based on stale snapshot $S_{\text{stale}}$:

```json
{
  "command": "patchBlock",
  "blockId": "b-intro-p2",
  "expectedParentHash": "hash-stale-0012",
  "content": {
    "type": "paragraph",
    "children": [
      {
        "text": "Parasuraman and Manzey (2010) demonstrated that automation complacency occurs when operators rely uncritically on automated recommendations."
      }
    ]
  }
}
```

_The Disaster Averted_: If executed directly, this patch would wipe out 4 sentences of nuanced argument that the human researcher just finished typing!

---

## 2. Collision Interception & Human Researcher Directive

CollarAgent's optimistic concurrency guard detects that the active document's parent hash has advanced ($S_{\text{live}} \neq S_{\text{stale}}$). The patch is immediately gated into the staging holding area:

```markdown
User:
Warning! The citation formatter agent is trying to apply a patch based on an old version of Paragraph 2!
If this commits, it will clobber my new sentences on cognitive tunneling.

1. Reject and abort the stale patch immediately.
2. Invert any speculative buffer state via the Inverse Command Engine.
3. Re-read my live document state, re-base the citation changes on top of my new text,
   and stage the non-conflicting diff for my visual inspection.
```

---

## 3. Mathematical Command Inversion via `InverseCommandEngine`

CollarAgent immediately aborts the pending commit and executes an inverse command stream to guarantee that the speculative buffer leaves no residual artifacts:

$$\text{Rollback: } S_{\text{speculative}} \xrightarrow{\text{Inverse Stream } \vec{C}^{-1}} S_{\text{live}}$$

```typescript
// InverseCommandEngine.ts cleans speculative staging buffers
const abortCommands = [
  { type: 'REVERT_SPECULATIVE_BUFFER', targetBlockId: 'b-intro-p2' },
  { type: 'PURGE_STALE_PROPOSAL', proposalId: 'prop-citation-fmt-88' }
]

const inverseStream = InverseCommandEngine.invert(abortCommands)
await executeDocumentCommands('HCI_Manuscript_Draft', inverseStream)
```

---

## 4. Intelligent Re-Base onto Live Human State

Following the rollback of the stale patch, DeepAgent re-reads the active document AST via [`readDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L770), computes the semantic delta, and applies the citation formatting _only_ to the relevant citation token while preserving the researcher's newly authored sentences:

### Live Re-based Staged Diff Proposal:

```diff
  Parasuraman and Manzey (2010) demonstrated that when automated tools operate with
  high apparent fluency, human monitors rapidly develop automation complacency, failing
  to verify erroneous recommendations.
+ In safety-critical authoring, this triggers cognitive tunneling, blinding the user
+ to ungrounded causal inversions and fabricated source citations (Goldwater et al., 2026).
```

---

## 5. Invariant Verification: 100% Snapshot Byte Parity on Human Edits

[`AssertionEngine.assertRollbackParity`](file:///Users/goldenfung/Documents/collaragent/evals/assertions/AssertionEngine.ts#L162) verifies that the researcher's newly authored characters remain 100% intact:

```typescript
const parityResult = AssertionEngine.assertRollbackParity(humanAuthoredState, postRebaseState)

console.log(parityResult)
// {
//   matches: true,
//   byteParity: true,
//   diffSummary: "Human-authored text preserved with 100% character fidelity; 0 lost keystrokes",
//   errors: []
// }
```

| Invariant Parameter    | Human Live State ($S_{\text{live}}$) | Post-Rollback & Rebase ($S_{\text{final}}$) | Verification Result |
| :--------------------- | :----------------------------------- | :------------------------------------------ | :------------------ |
| **Human Text Tokens**  | 48 words (newly typed)               | 48 words (100% retained)                    | **Preserved**       |
| **Document AST Hash**  | Clean live branch                    | Non-conflicting clean commit                | **Match**           |
| **Canvas Graph Nodes** | 19                                   | 19                                          | **Unaltered**       |
| **Orphan Block Keys**  | 0                                    | 0                                           | **Clean Invariant** |

---

## 6. Scientific Research Takeaway

1. **Zero Data-Loss Guarantee**: Academic authors will never tolerate an AI assistant that risks overwriting their intellectual prose. Optimistic concurrency control and inverse rollback provide absolute data safety.
2. **True Mixed-Initiative Synthesis**: Rather than failing abruptly on concurrent collisions, the system dynamically re-bases agent proposals onto live human state, embodying Horvitz's principle of fluid collaborative handovers.
3. **Calibrated Trust**: The researcher maintains full confidence that DeepAgent acts as a cooperative co-pilot that respects human primacy, rather than an autonomous tyrant that silently overwrites human work.
