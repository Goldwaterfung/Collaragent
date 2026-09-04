---
name: research-stage-1-brainstorming
description: Multi-agent research brainstorming and systems mapping skill. Deconstructs research topics from First Principles into core subsystems, micro-components, dynamic relationships, and feedback loops on the Concept Canvas using specialized subagents.
---

# Research Stage 1: Idea Brainstorming & Systems Mapping

Stage 1 multi-agent orchestration skill for externalizing mental models, exploring problem spaces, and constructing interactive knowledge graphs on the CollarAgent Concept Canvas before any code or writing begins.

---

## When to Use This Skill

- Initiating a new research exploration or transitioning from a vague research goal to a structured conceptual model.
- Mapping complex multi-disciplinary systems with interconnected dependencies and feedback loops (e.g. Cognitive Psychology, Psychoacoustics, HCI, Neuroscience, Clinical AI).
- Structuring the 2D Concept Canvas to serve as the visual shared memory for subsequent literature search, hypothesis formalization, and manuscript drafting.

---

## Integrated Foundation Skills

This stage integrates and operationalizes principles from:

- **`holistic-thinking-analyst`**:
  - Implements the 3-step First Principles method (Challenge Assumptions $\rightarrow$ Deconstruct to Irreducible Facts $\rightarrow$ Rebuild Frame).
  - Categorizes systems into maximum 4–5 macro-level structural pillars.
  - Formulates directional semantic edge labels and discovers reinforcing/balancing feedback loops.
- **`focused-execution-specialist`**:
  - Directs subagents to execute bounded mapping tasks with zero scope drift.

---

## Multi-Agent Subagent Worker Topology

The Stage 1 Orchestrator directs four specialized subagent workers in sequence:

```
                  [Stage 1 Brainstorming Orchestrator]
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
[Subagent 1: Deconstructor]  [Subagent 2: Architect]     [Subagent 3: Graph Modeler]
(First Principles & 5 Whys)   (4-5 Macro Subsystems)      (writeMindMap & writeGraph)
                                                                    │
                                                                    ▼
                                                         [Subagent 4: Loop Analyst]
                                                         (Feedback Loops & Leverage)
```

### Worker Roles & Delegation Contracts

| Subagent Worker Role           | Responsibility                                                                                              | Input Contract                        | Expected Deliverable                                                |
| :----------------------------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------ | :------------------------------------------------------------------ |
| **`conceptual-deconstructor`** | Challenges domain assumptions; strips problem to irreducible physical/cognitive truths using the Five Whys. | Research topic prompt from user.      | Structured First Principles statement and lateral frame.            |
| **`subsystem-architect`**      | Categorizes domain into max 4-5 macro subsystems and identifies micro-components.                           | Irreducible truths from Worker 1.     | 4-5 structural pillars with child node lists.                       |
| **`canvas-graph-modeler`**     | Plants hierarchy via `writeMindMap` and maps directional dependency vectors via `writeGraph`.               | Subsystem architecture from Worker 2. | Executed `writeMindMap` and `writeGraph` canvas calls.              |
| **`feedback-loop-analyst`**    | Traces reinforcing and balancing feedback loops, second-order effects, and leverage points.                 | Active canvas graph state.            | Annotated feedback loops and identified leverage intervention node. |

---

## Step-by-Step Multi-Agent Execution Protocol

### Step 1: First Principles Deconstruction (`conceptual-deconstructor`)

The subagent unpacks foundational truths inside its internal reasoning sequence:

1. **Challenge Assumptions**: List conventional beliefs about the research topic and identify which are mere habits or traditions.
2. **Deconstruct to Irreducible Facts**: Apply the **Five Whys** until reaching atomic physical laws, mathematical necessities, or biological constraints (e.g. human working memory buffer limits, acoustic propagation speed).
3. **Rebuild the Frame**: Reconstruct the problem from the ground up and perform a **Lateral Check** (is there a non-obvious angle that changes the question entirely?).

### Step 2: Macro Subsystems & Micro-Components (`subsystem-architect`)

1. Restrict top-level branches to a **maximum of 4 to 5 structural pillars** to preserve cognitive clarity.
   - Example pillars: `[PHYS] Physical/Signal Constraints`, `[ANAT] Anatomical/Physiological Cues`, `[DSP] Computing/Algorithmic Pipeline`, `[PERC] Human Perception & Latency`.
2. Deconstruct each macro pillar into 3 to 5 micro-system entities.

### Step 3: Planting the Concept Canvas Hierarchy (`canvas-graph-modeler`)

1. Invoke `writeMindMap` to plant the central research topic and the structural pillars.
2. Node naming standard: Use bracketed tags and clarifiers (e.g., `[WM] Working Memory`, `ITD (< 1.5 kHz)`) to encode semantics directly into node labels.

### Step 4: Directional Vector & Feedback Mapping (`canvas-graph-modeler` & `feedback-loop-analyst`)

1. Invoke `writeGraph` in `merge` mode to draw cross-subsystem relationship edges.
2. **Label Directive**: Every edge MUST have an active directional verb (e.g., `triggers`, `inhibits`, `externalizes & offloads`, `resolves cone of confusion`). Unlabeled edges are strictly forbidden.
3. Identify **Reinforcing Loops** (compounding effects) and **Balancing Loops** (natural brakes or stabilizing forces).

### Step 5: Second-Order Effects & Leverage Point Identification

1. Ask **"And then what?"** for key relationships to anticipate delayed side-effects (e.g. high visual clutter $\rightarrow$ delayed P300 latency $\rightarrow$ decision bottleneck).
2. Isolate the **Highest-Leverage Point**: The specific node or relationship where a targeted intervention produces the maximum systemic improvement.

### Step 6: Human Gate Verification

Present the generated Concept Canvas to the human researcher for visual inspection and interactive layout approval before advancing to Stage 2.

---

## Workspace Tool Call Signatures & Examples

### 1. Plant Structural Hierarchy (`writeMindMap`)

```json
{
  "instanceName": "Cognitive-Load-Canvas",
  "projectName": "Research-Workspace",
  "direction": "RADIAL",
  "root": {
    "entity": "Cognitive Load in Multimodal Sensemaking",
    "children": [
      {
        "entity": "[WM] Working Memory Subsystems",
        "children": [
          { "entity": "Central Executive (Attentional Control)" },
          { "entity": "Phonological Loop (Verbal Buffer)" },
          { "entity": "Visuospatial Sketchpad (Spatial Representation)" }
        ]
      },
      {
        "entity": "[CLT] Cognitive Load Types (Sweller)",
        "children": [
          { "entity": "Intrinsic Load (Material Complexity)" },
          { "entity": "Extraneous Load (Interface Friction)" },
          { "entity": "Germane Load (Schema Construction)" }
        ]
      },
      {
        "entity": "[UI] Workspace Modality",
        "children": [
          { "entity": "Infinite Concept Canvas (2D Graphs)" },
          { "entity": "Lexical Scholarly Editor (1D Text)" }
        ]
      }
    ]
  }
}
```

### 2. Connect Cross-Subsystem Relationships & Loops (`writeGraph`)

```json
{
  "instanceName": "Cognitive-Load-Canvas",
  "projectName": "Research-Workspace",
  "direction": "LR",
  "mode": "merge",
  "nodes": [
    { "entity": "Infinite Concept Canvas (2D Graphs)" },
    { "entity": "Visuospatial Sketchpad (Spatial Representation)" },
    { "entity": "Extraneous Load (Interface Friction)" },
    { "entity": "Central Executive (Attentional Control)" },
    { "entity": "Germane Load (Schema Construction)" },
    { "entity": "Intrinsic Load (Material Complexity)" }
  ],
  "edges": [
    {
      "from": "Infinite Concept Canvas (2D Graphs)",
      "to": "Visuospatial Sketchpad (Spatial Representation)",
      "label": "externalizes & offloads"
    },
    {
      "from": "Infinite Concept Canvas (2D Graphs)",
      "to": "Extraneous Load (Interface Friction)",
      "label": "reduces visual search friction"
    },
    {
      "from": "Extraneous Load (Interface Friction)",
      "to": "Central Executive (Attentional Control)",
      "label": "depletes capacity (inhibits)"
    },
    {
      "from": "Central Executive (Attentional Control)",
      "to": "Germane Load (Schema Construction)",
      "label": "enables high-order synthesis"
    },
    {
      "from": "Germane Load (Schema Construction)",
      "to": "Intrinsic Load (Material Complexity)",
      "label": "reduces via chunking (reinforcing loop)"
    }
  ]
}
```

### 3. Read Canvas Graph State (`readGraph`)

```json
{
  "instanceName": "Cognitive-Load-Canvas",
  "projectName": "Research-Workspace",
  "includeMemo": true
}
```

---

## Error Handling & Invariant Rules

1. **Unique Entity Invariant**:
   - When calling `writeGraph` or `writeMindMap`, ensure all node entities have distinct, unambiguous names. Do not generate duplicate node labels that collide during edge linking.
2. **DAG Invariant Enforcement**:
   - While feedback loops are conceptually cyclic, semantic dependency trees in CollarAgent should avoid circular path locks. Represent feedback loops with explicit semantic edge verbs (e.g. `label: "reinforces (feedback loop)"`) while maintaining valid node-link schemas.
3. **No Phantom Tool Invocations**:
   - Only use verified canvas tools (`writeMindMap`, `writeGraph`, `readGraph`). Do not attempt to invoke non-existent canvas styling APIs.

---

## Stage 1 Gate Exit Checklist

Before declaring Stage 1 complete and handing off to Stage 2 (`research-stage-2-literature-retrieval`):

- [ ] Mind Map hierarchy has been planted on the active Concept Canvas.
- [ ] At least 12 to 18 interconnected concept nodes are present and mapped.
- [ ] Every relationship edge contains an explicit, descriptive directional verb.
- [ ] At least 1 reinforcing or balancing feedback loop is documented.
- [ ] The highest-leverage intervention point has been identified and annotated.
- [ ] The human researcher has verified the visual layout in the CollarAgent canvas pane.
