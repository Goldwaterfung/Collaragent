---
name: research-stage-2-literature-retrieval
description: Multi-agent empirical literature search and gap analysis skill. Queries academic databases, synthesizes empirical findings into a comparative evidence matrix, and projects citations and research gaps onto the Concept Canvas using subagents.
---

# Research Stage 2: Literature Retrieval & Gap Analysis

Stage 2 multi-agent orchestration skill for conducting systematic academic literature searches, extracting empirical findings and effect sizes, compiling structured evidence matrices, and isolating publishable research gaps.

---

## When to Use This Skill

- Grounding the conceptual model constructed in Stage 1 with empirical peer-reviewed literature.
- Comparing prior experimental setups, sample sizes, and empirical boundaries across disciplines.
- Identifying contradictions, unexamined variables, or missing modalities in existing literature.
- Establishing the empirical justification for the hypotheses in Stage 3.

---

## Integrated Foundation Skills

This stage integrates and operationalizes principles from:

- **`apa-research-execution-specialist`**:
  - **Context First, Action Second**: Reads the active canvas graph state before searching, ensuring queries align with macro-level research pillars.
  - **Linear Thinking Mode**: Enforces disciplined progression (Search $\rightarrow$ Appraisal $\rightarrow$ Matrix Draft $\rightarrow$ Canvas Projection).
  - **Feedback Loop Mandate**: Mandates that every newly verified citation and discovered literature gap MUST be reported back to the Concept Canvas via `writeGraph` in `merge` mode.
  - **APA 7 Citation Compliance**: Enforces standardized author-year citation formatting and complete reference schemas.
- **`focused-execution-specialist`**:
  - Keeps literature extraction focused on core dependent and independent variables without scope creep.

---

## Multi-Agent Subagent Worker Topology

The Stage 2 Orchestrator coordinates four specialized subagent workers:

```
                  [Stage 2 Literature Orchestrator]
                                  │
    ┌─────────────────────────────┼─────────────────────────────┐
    ▼                             ▼                             ▼
[Subagent 1: Scout]       [Subagent 2: Synthesizer]    [Subagent 3: Canvas Linker]
(Academic Search Queries) (Comparative Evidence Table) (writeGraph merge Citation Nodes)
                                                                │
                                                                ▼
                                                       [Subagent 4: Gap Validator]
                                                       (Novelty & Defensibility Check)
```

### Worker Roles & Delegation Contracts

| Subagent Worker Role              | Responsibility                                                                                                   | Input Contract                                           | Expected Deliverable                                              |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- | :---------------------------------------------------------------- |
| **`literature-scout-specialist`** | Formulates and executes targeted queries across academic sources via `internetSearch`.                           | Subsystem pillars and concept nodes from Stage 1 canvas. | Curated list of peer-reviewed papers with publication metadata.   |
| **`evidence-matrix-synthesizer`** | Extracts empirical parameters (sample size $N$, paradigms, effect sizes, limitations) into a Lexical table.      | Full text / abstracts from Worker 1.                     | `Literature_Review_Matrix` document created via `createDocument`. |
| **`canvas-citation-linker`**      | Projects verified citations and the isolated research gap back onto the Concept Canvas.                          | Verified study list and identified gap.                  | Executed `writeGraph` calls in `merge` mode.                      |
| **`gap-validator`**               | Evaluates whether the identified gap represents a publishable contribution and verifies construct defensibility. | Drafted matrix and updated canvas.                       | Formalized Research Gap statement ready for human gate signoff.   |

---

## Step-by-Step Multi-Agent Execution Protocol

### Step 1: Context Ingestion & Query Trajectory (`literature-scout-specialist`)

1. Read the current Concept Canvas using `readGraph` to identify the core theoretical nodes that require empirical grounding.
2. Formulate 3 to 4 targeted academic search queries combining theoretical constructs, experimental paradigms, and boundary conditions:
   - Query 1 (Theoretical Baseline): `"[Theoretical Model] empirical study [Primary Construct]"`
   - Query 2 (Experimental Paradigm): `"[Paradigm Name] [Independent Variable] [Dependent Variable] results"`
   - Query 3 (Boundary / Cross-Modal): `"[Modality A] [Modality B] interaction effect detection threshold"`
3. Execute queries using `internetSearch`.

### Step 2: Critical Appraisal & Extraction (`evidence-matrix-synthesizer`)

For each retrieved study, extract:

1. **Citation**: Formal APA 7 in-text reference (e.g. `Sweller & Chandler (1994)`).
2. **Apparatus & Setup**: Physical apparatus, software engine, or testing conditions.
3. **Key Finding**: Statistically significant outcomes, effect sizes ($\eta_p^2$, Cohen's $d$, $r$, or $p$-values).
4. **Critical Limitation**: Methodological constraints (e.g. tested in darkness, passive viewing only, small $N$, lacked real-time continuous latency telemetry).

### Step 3: Creating the Literature Review Matrix (`evidence-matrix-synthesizer`)

Invoke `createDocument` to compile `Literature_Review_Matrix` in the workspace.

- Format the content with an APA-compliant structured table.
- Table columns: `Study (Citation)`, `Theoretical Focus`, `Experimental Paradigm`, `Key Findings`, `Critical Limitation / Gap`.

### Step 4: Canvas Graph Projection (`canvas-citation-linker`)

In strict adherence to the **Feedback Loop Mandate**:

1. Connect verified citations to their parent theoretical constructs on the Concept Canvas using `writeGraph` in `merge` mode with `label: "grounded by"`.
2. Plant a prominent new node: `RESEARCH GAP: [Descriptive Title]` and link it to the affected subsystems with `label: "exposes empirical boundary"`.

### Step 5: Research Gap Formalization (`gap-validator`)

Synthesize why the existing literature fails to answer the current question:

- _What is known_: Prior work established baseline effects in isolated, artificial, or non-interactive setups.
- _What is missing_: How those effects interact under dynamic, multi-modal, or real-time collaborative conditions.
- _Why it matters_: Resolving this gap directly informs system design and scientific understanding.

### Step 6: Human Gate Verification

Present the comparative matrix and updated canvas graph to the human researcher for review before proceeding to Stage 3 (Hypothesis Formulation).

---

## Workspace Tool Call Signatures & Examples

### 1. Academic Search Queries (`internetSearch`)

```json
{
  "query": "Sweller split attention effect dual visual text interface empirical study"
}
```

```json
{
  "query": "dynamic binaural synthesis motion to sound latency detection threshold Lindau"
}
```

### 2. Create Literature Review Matrix Document (`createDocument`)

```json
{
  "instanceName": "Literature_Review_Matrix",
  "projectName": "Research-Workspace",
  "html_content": "<h1>Empirical Literature Review &amp; Comparative Evidence Matrix</h1><p>This matrix synthesizes empirical precedents to establish our baseline and isolate the unexamined research gap.</p><table><tr><th>Study (Citation)</th><th>Theoretical Focus</th><th>Experimental Paradigm</th><th>Key Findings</th><th>Methodological Boundary / Research Gap</th></tr><tr><td>Lindau et al. (2012)</td><td>Motion-to-Sound Latency</td><td>OptiTrack optical 6-DoF, BRIR simulated room</td><td>50% detection threshold JND = 38.5 ms (SE = 4.2 ms).</td><td>Acoustic-only in darkness; no visual environment provided to trigger ventriloquism.</td></tr><tr><td>Alais &amp; Burr (2004)</td><td>Audiovisual Spatial Binding</td><td>Psychophysical spatial alignment bench</td><td>Demonstrated optimal Bayesian Maximum Likelihood Estimation (MLE) capture.</td><td>Static listener fixation; did not measure dynamic rotational latency.</td></tr></table>"
}
```

### 3. Project Citations and Gap Back to Canvas (`writeGraph`)

```json
{
  "instanceName": "Cognitive-Load-Canvas",
  "projectName": "Research-Workspace",
  "direction": "LR",
  "mode": "merge",
  "nodes": [
    { "entity": "Lindau et al. (2012)" },
    { "entity": "Alais & Burr (2004)" },
    { "entity": "RESEARCH GAP: Dynamic 6-DoF Visual Anchoring" }
  ],
  "edges": [
    {
      "from": "Latency Just Noticeable Difference (JND)",
      "to": "Lindau et al. (2012)",
      "label": "grounded by baseline (38.5 ms)"
    },
    {
      "from": "Auditory-Visual Ventriloquism Capture",
      "to": "Alais & Burr (2004)",
      "label": "governed by Bayesian MLE"
    },
    {
      "from": "Latency Just Noticeable Difference (JND)",
      "to": "RESEARCH GAP: Dynamic 6-DoF Visual Anchoring",
      "label": "exposes empirical boundary"
    }
  ]
}
```

### 4. Read Canvas and Document State (`readGraph` / `readDocument`)

```json
{
  "instanceName": "Literature_Review_Matrix",
  "projectName": "Research-Workspace"
}
```

```json
{
  "instanceName": "Cognitive-Load-Canvas",
  "projectName": "Research-Workspace",
  "includeMemo": true
}
```

---

## Error Handling & Invariant Rules

1. **Table Rectangularity Invariant**:
   - Every row inside the Lexical table AST must contain the exact same number of table cells (`tablecell`). Jagged rows violate AST integrity and crash rendering.
2. **Search Rate-Limiting & Backoff**:
   - If search queries encounter rate-limiting or network backpressure, wait exponentially (1s, 2s, 4s) before retrying. Do not spam repetitive queries.
3. **No Hallucinated Citations**:
   - Never invent paper titles, authors, or DOIs. If a citation cannot be verified through search results, state that the empirical claim is unconfirmed and request user clarification.
4. **Preserve Canvas Invariants**:
   - Always invoke `writeGraph` in `mode: "merge"` when projecting citations, preventing accidental erasure of the Stage 1 concept hierarchy.

---

## Stage 2 Gate Exit Checklist

Before declaring Stage 2 complete and handing off to Stage 3 (`research-stage-3-hypothesis-formulation`):

- [ ] At least 4 to 6 relevant peer-reviewed studies have been retrieved and evaluated.
- [ ] The `Literature_Review_Matrix` document exists in the workspace with complete table rows.
- [ ] Every included study lists empirical findings, effect sizes/thresholds, and specific limitations.
- [ ] Newly verified citations have been linked to parent theoretical nodes on the Concept Canvas.
- [ ] An explicit, defensible scientific research gap is identified and planted on the canvas.
- [ ] The human researcher has verified and approved the research gap.
