---
name: research-stage-3-hypothesis-formulation
description: Multi-agent research question and hypothesis formalization skill. Operationalizes theoretical constructs into independent, dependent, and controlled variables, and authors falsifiable directional statistical hypotheses in scholarly document format using subagents.
---

# Research Stage 3: Hypothesis & Research Question Formulation

Stage 3 multi-agent orchestration skill for translating isolated scientific literature gaps into formal, falsifiable Research Questions ($RQ$) and directional statistical hypotheses ($H$). Operationalizes theoretical constructs into concrete experimental variables.

---

## When to Use This Skill

- Transitioning from an identified literature gap (Stage 2) to an empirical experimental design (Stage 4).
- Formalizing ambiguous research intentions into mathematically falsifiable directional hypotheses.
- Defining the operational variable matrix (Independent Variables, Dependent Variables, Confounding Factors, and Covariates) with explicit measurement instruments and units.
- Generating formal hypothesis documentation within the CollarAgent Lexical workspace.

---

## Integrated Foundation Skills

This stage integrates and operationalizes principles from:

- **`focused-execution-specialist`**:
  - Operates in strict **Linear Execution Mode** (Variable Operationalization $\rightarrow$ RQ Synthesis $\rightarrow$ Directional Hypothesis Formalization $\rightarrow$ Document Staging).
  - Eliminates scope creep and rejects unoperationalized or speculative constructs.
- **`apa-research-execution-specialist`**:
  - Enforces APA 7th Edition variable architecture standards, formal mathematical notation, and heading cascades.
  - Ensures seamless linkage between the Stage 2 literature gap and Stage 3 theoretical framing.

---

## Multi-Agent Subagent Worker Topology

The Stage 3 Orchestrator coordinates four specialized subagent workers:

```
                [Stage 3 Hypothesis Orchestrator]
                                │
    ┌───────────────────────────┼───────────────────────────┐
    ▼                           ▼                           ▼
[Subagent 1: Operationalizer] [Subagent 2: RQ Synthesizer] [Subagent 3: Hypothesis Author]
(IV/DV Variable Matrix)       (Formal Research Questions)   (H0 vs HA Directional Claims)
                                                                    │
                                                                    ▼
                                                         [Subagent 4: Document Stager]
                                                         (createDocument & Gate Signoff)
```

### Worker Roles & Delegation Contracts

| Subagent Worker Role                | Responsibility                                                                                                             | Input Contract                                        | Expected Deliverable                                          |
| :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------- | :------------------------------------------------------------ |
| **`variable-operationalizer`**      | Deconstructs theoretical constructs into concrete $IV$s, $DV$s, and control variables with explicit instruments and units. | Research gap and theoretical nodes from Stages 1 & 2. | Comprehensive variable operationalization matrix.             |
| **`rq-synthesizer`**                | Drafts concise, focused Research Questions targeting the specific empirical boundary.                                      | Operationalized variable matrix from Worker 1.        | 2 to 3 formal, unambiguous Research Questions ($RQ_1, RQ_2$). |
| **`statistical-hypothesis-author`** | Formulates falsifiable directional hypotheses, defining null ($H_0$) and alternative ($H_A$) mathematical expectations.    | Research Questions and operational variables.         | Mathematical and narrative directional hypothesis statements. |
| **`document-stager`**               | Persists the complete specification into `Formal_Hypotheses_and_RQs` via `createDocument` / `editDocument`.                | Synthesized hypotheses and operational table.         | Persisted Lexical document AST ready for human gate signoff.  |

---

## Step-by-Step Multi-Agent Execution Protocol

### Step 1: Gap Ingestion & Construct Mapping (`variable-operationalizer`)

1. Read the active literature gap from `Literature_Review_Matrix` via `readDocument` and inspect related nodes via `readGraph`.
2. Map abstract conceptual constructs into physical, behavioral, or psychological manifestations (e.g. "Cognitive Load" $\rightarrow$ NASA-TLX score + secondary probe reaction time in ms; "Spatial Latency" $\rightarrow$ injected buffer delay in ms).

### Step 2: Operationalizing the Factorial Variable Matrix (`variable-operationalizer`)

Construct the formal variable taxonomy:

1. **Independent Variables ($IV$)**: Define factor levels (e.g. 2 levels or 3 levels), condition boundaries, and manipulation checks.
2. **Dependent Variables ($DV$)**: Define exact measurement scale (continuous ms, 7-point Likert, degrees RMSE, $d'$ sensitivity index), sampling rate, and apparatus.
3. **Controlled Variables & Covariates**: Specify inclusion/exclusion thresholds, demographic balances, and baseline calibration controls.

### Step 3: Formulating Core Research Questions (`rq-synthesizer`)

Draft 2 to 3 concise, focused Research Questions ($RQ$):

- $RQ_1$ (Main Effect / Threshold): Investigates the primary relationship between the main $IV$ and $DV$.
- $RQ_2$ (Cross-Modal / Interaction Effect): Investigates how a secondary contextual factor modulates or reverses the primary effect.
- $RQ_3$ (Dissociation / Mechanism): Investigates whether the observed behavioral change represents a conscious perceptual shift or unconscious performance degradation.

### Step 4: Authoring Falsifiable Directional Hypotheses (`statistical-hypothesis-author`)

Translate each Research Question into a directional statistical hypothesis:

1. State the **Narrative Hypothesis**: Clear, plain-language directional prediction grounded in Stage 2 literature.
2. State the **Mathematical Specification**: Explicit comparison between population parameters (e.g., $\mu_1 > \mu_2$, $d' > 2.0$, $F(2, N-k) > F_{\text{crit}}$).
3. State the **Null Hypothesis ($H_0$)**: The exact condition under which the theoretical claim is falsified.

### Step 5: Document Compilation (`document-stager`)

Invoke `createDocument` to author `Formal_Hypotheses_and_RQs` in the workspace.

- Include the complete Variable Architecture Table.
- Include structured H2 subsections for each hypothesis with bold labels and mathematical blocks.

### Step 6: Human Gate Verification

Present the operationalized document to the human researcher. The researcher reviews factorial feasibility, ensures no confounding variables were overlooked, and authorizes advancing to Stage 4 (Methodology).

---

## Workspace Tool Call Signatures & Examples

### 1. Create Formal Hypotheses Document (`createDocument`)

```json
{
  "instanceName": "Formal_Hypotheses_and_RQs",
  "projectName": "Research-Workspace",
  "html_content": "<h1>Formal Research Questions &amp; Directional Hypotheses</h1><h2>1. Operationalized Variable Architecture</h2><p>The investigation employs a 2 (Visual Context: Auditory-Only vs. Multimodal 6-DoF Anchor) x 2 (Head Rotational Velocity: 20 deg/s vs. 60 deg/s) repeated-measures within-subjects design.</p><table><tr><th>Variable Type</th><th>Construct Name</th><th>Operational Definition</th><th>Measurement Scale / Metric</th></tr><tr><td>Independent Variable 1</td><td>Visual Context Modality</td><td>Visual reference frame available during listening</td><td>2 Levels: Auditory-Only vs. Multimodal 6-DoF Room</td></tr><tr><td>Independent Variable 2</td><td>Head Angular Velocity</td><td>Rotational speed around head yaw axis</td><td>2 Levels: Slow (20 deg/s) vs. Fast (60 deg/s)</td></tr><tr><td>Dependent Variable 1</td><td>Latency JND Threshold</td><td>Injected delay detected at 79.4% probability</td><td>Milliseconds (ms) via 3-down / 1-up staircase</td></tr></table><h2>2. Directional Hypotheses</h2><p><b>H1 (Velocity Main Effect): </b>Fast head rotations (60 deg/s) will significantly sharpen latency detection, reducing the JND threshold compared to slow rotations (20 deg/s): JND_60 &lt; JND_20, p &lt; .01.</p><p><b>H2 (Cross-Modal Anchoring Expansion): </b>The presence of a congruent 6-DoF visual sound source will significantly expand the latency tolerance envelope via the ventriloquism effect: JND_Multimodal &gt; JND_Auditory, Delta JND &gt;= 15 ms.</p>"
}
```

### 2. Update Existing Document with Staged Edit (`editDocument`)

```json
{
  "instanceName": "Formal_Hypotheses_and_RQs",
  "projectName": "Research-Workspace",
  "operations": [
    {
      "action": "insert",
      "blockId": "b_h2_paragraph",
      "anchor": "after",
      "newHtml": "<p><b>H3 (Localization Independence): </b>Injected latencies residing below the conscious JND threshold will not impair absolute sound localization accuracy (RMSE &lt; 2.5 degrees).</p>"
    }
  ],
  "explanation": "Append H3 hypothesis statement regarding sub-threshold localization invariance"
}
```

### 3. Read Literature Matrix State (`readDocument`)

```json
{
  "instanceName": "Literature_Review_Matrix",
  "projectName": "Research-Workspace"
}
```

---

## Error Handling & Invariant Rules

1. **Strict Falsifiability Invariant**:
   - Reject tautological or untestable statements (e.g. "AI assistance will change the way researchers write"). Every hypothesis must make an explicit directional commitment that can be confirmed or refuted by empirical data.
2. **Measurement Operationalization Invariant**:
   - Reject any variable that lacks an unambiguous measurement scale or unit (e.g. "User Satisfaction" is unacceptable without specifying a validated psychometric instrument like SUS, NASA-TLX, or SoA).
3. **Table Schema Rectangularity**:
   - Ensure the Variable Architecture table has an identical number of `tablecell` elements across every row.
4. **Non-Destructive Revisions**:
   - When refining hypotheses based on user feedback, use targeted `editDocument` commands rather than wiping out the entire document payload.

---

## Stage 3 Gate Exit Checklist

Before declaring Stage 3 complete and handing off to Stage 4 (`research-stage-4-experimental-methodology`):

- [ ] All Independent Variables have clearly defined factor levels and operational controls.
- [ ] All Dependent Variables specify concrete physical, psychometric, or behavioral metrics with exact units.
- [ ] Confounding variables and covariates are explicitly documented.
- [ ] Formal Research Questions ($RQ_1, RQ_2$) articulate specific empirical tensions.
- [ ] Hypotheses specify mathematical directionality and null criteria ($H_0$).
- [ ] The `Formal_Hypotheses_and_RQs` document is persisted in the workspace.
- [ ] The human researcher has verified and signed off on the hypothesis specification.
