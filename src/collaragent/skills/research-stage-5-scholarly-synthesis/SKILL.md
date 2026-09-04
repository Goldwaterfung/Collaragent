---
name: research-stage-5-scholarly-synthesis
description: Multi-agent academic manuscript compilation skill conforming strictly to APA 7th Edition standards. Compiles Title Page, Abstract, Introduction, Method, Planned Results Table, and References without schema drift using subagents.
---

# Research Stage 5: Structured Scholarly Synthesis (APA 7)

Stage 5 multi-agent orchestration skill for assembling, formatting, and compiling publication-grade academic research manuscripts in strict compliance with the American Psychological Association (APA) 7th Edition Publication Manual.

---

## When to Use This Skill

- Synthesizing completed research outputs (Stages 1–4) into a cohesive, ready-to-submit journal manuscript.
- Formatting academic documents with APA 7th Edition structural standards (Title Page, Abstract, Headings, Tables, In-Text Citations, and Reference List).
- Generating APA Table 1 with strict 3-horizontal-rule styling and zero vertical borders.
- Verifying 1-to-1 parity between in-text citations and bibliographic references.

---

## Integrated Foundation Skills

This stage integrates and operationalizes principles from:

- **`apa-research-execution-specialist`**:
  - **Title Page & Metadata**: Standardized author note, institutional affiliation, and running head.
  - **Abstract Constraints**: Strictly between 150 and 250 words, accompanied by 3–5 italicized _Keywords:_.
  - **Heading Levels (APA 7)**:
    - Level 1: Centered, Bold, Title Case Heading.
    - Level 2: Flush Left, Bold, Title Case Heading.
    - Level 3: Flush Left, Bold Italic, Title Case Heading.
  - **Table 1 Formatting**: Strict 3 horizontal rules (table top, bottom of header, table bottom) and **zero vertical lines**.
  - **Reference List**: Hanging indent, alphabetical ordering by first author surname, inclusion of permanent DOIs (`https://doi.org/...`).
- **`focused-execution-specialist`**:
  - Manages section-level task distribution across subagents, preventing stylistic drift or phantom claims.

---

## Multi-Agent Subagent Worker Topology

The Stage 5 Orchestrator coordinates four specialized subagent workers:

```
                  [Stage 5 Manuscript Orchestrator]
                                  │
    ┌─────────────────────────────┼─────────────────────────────┐
    ▼                             ▼                             ▼
[Subagent 1: Assembler]     [Subagent 2: APA Formatter]   [Subagent 3: Table Specialist]
(Narrative & Literature Gap) (Abstract & Heading Levels)   (APA Table 1 Three-Border)
                                                                    │
                                                                    ▼
                                                       [Subagent 4: Manuscript Stager]
                                                       (createDocument & Reference Parity)
```

### Worker Roles & Delegation Contracts

| Subagent Worker Role       | Responsibility                                                                                                     | Input Contract                                            | Expected Deliverable                                                |
| :------------------------- | :----------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------- | :------------------------------------------------------------------ |
| **`manuscript-assembler`** | Synthesizes prior stage deliverables (Literature Matrix, Hypotheses, Protocol) into an academic narrative.         | Stage 1–4 documents and active canvas state.              | Section drafts for Introduction, Method, and Planned Discussion.    |
| **`apa-formatter`**        | Formats Title Page, drafts 150–250 word Abstract with keywords, and enforces APA Level 1–3 headings.               | Assembled manuscript sections.                            | Standardized APA 7 document structure with verified word count.     |
| **`table-ast-specialist`** | Compiles Planned Results Table 1 adhering to the strict 3-horizontal-rule APA table specification.                 | Operational variables and predicted statistical outcomes. | Valid HTML `<table>` with zero vertical lines and rectangular rows. |
| **`manuscript-stager`**    | Conducts 1-to-1 citation parity audit and writes the full manuscript into `Manuscript_Draft` via `createDocument`. | Formatted text, Table 1, and reference list.              | Persisted Lexical document AST ready for human gate signoff.        |

---

## Step-by-Step Multi-Agent Execution Protocol

### Step 1: Ingestion of Upstream Research Deliverables

The orchestrator reads workspace documents from prior stages using `readDocument`:

1. `Literature_Review_Matrix` (Stage 2) $\rightarrow$ Informs theoretical grounding and empirical gap.
2. `Formal_Hypotheses_and_RQs` (Stage 3) $\rightarrow$ Informs Research Questions and directional predictions.
3. `Methodology_Protocol` (Stage 4) $\rightarrow$ Informs Participants, Apparatus, Design, and Procedure.

### Step 2: Drafting Title Page & Abstract (`apa-formatter`)

1. Structure the Title Page:
   - Paper Title: Concise, clear, identifying independent and dependent variables.
   - Author Note & Affiliation.
2. Draft the Abstract:
   - **Word Count Gate**: Must measure between 150 and 250 words.
   - Covers: Problem/Context, Hypothesis, Method/Participants, Key Measurements, and Expected Theoretical Significance.
   - Concludes with _Keywords:_ followed by 3 to 5 comma-separated terms.

### Step 3: Drafting Introduction & Method (`manuscript-assembler`)

1. **Introduction**:
   - Opens with broad domain importance (Stage 1 systems context).
   - Reviews empirical literature and articulates the unaddressed research gap (Stage 2).
   - Concludes with formal Research Questions and directional hypotheses $H_1, H_2, H_3$ (Stage 3).
2. **Method**:
   - Subsections formatted with Level 2 headings: _Participants_, _Apparatus_, _Experimental Design_, and _Procedure_ (Stage 4).

### Step 4: Compiling APA Table 1 (`table-ast-specialist`)

Construct Planned Results Table 1 adhering to strict APA 7 styling rules:

- **Rule 1 (Three Horizontal Lines)**: Top of table, bottom of column header row, and bottom of table.
- **Rule 2 (No Vertical Lines)**: Strictly forbid vertical borders (`border-left: none; border-right: none`).
- **Rule 3 (Table Note)**: Include _Note._ in italics below the table explaining abbreviations, confidence intervals, or effect sizes.

### Step 5: Reference List & Parity Audit (`manuscript-stager`)

1. Audit every parenthetical citation in the text (e.g. `(Lindau et al., 2012)`) against the References section.
2. Ensure every reference has complete bibliographic metadata (authors, year, title, source, DOI).
3. Confirm zero orphan references (citations in text without references, or references without in-text citations).

### Step 6: Persisting Manuscript Document (`manuscript-stager`)

Invoke `createDocument` to commit `Manuscript_Draft` into the workspace.

### Step 7: Human Gate Verification

Present the complete manuscript to the human researcher for scholarly tone review and structural approval before advancing to Stage 6 (Critique & Rollback).

---

## Workspace Tool Call Signatures & Examples

### 1. Create Complete APA 7 Manuscript Document (`createDocument`)

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace",
  "html_content": "<h1 style=\"text-align: center\">Audiovisual Spatial Binding Expands Motion-to-Sound Latency Detection Thresholds in Dynamic Virtual Environments</h1><p style=\"text-align: center\"><b>Jane Doe &amp; John Smith</b><br>Department of Psychology, University of Research</p><h2 style=\"text-align: center\">Abstract</h2><p>In spatial audio computing, motion-to-sound latency must remain below conscious detection thresholds to prevent perceptual divergence. While acoustic-only investigations establish human latency just noticeable differences (JND) around 38 ms, ecological perception involves multimodal visual-auditory integration. This investigation examines whether a congruent 6-DoF visual sound source expands the human latency tolerance window via the ventriloquism effect. A repeated-measures within-subjects design (N = 40) crossed Visual Context (Auditory-Only vs. Multimodal 6-DoF Anchor) with Head Rotational Velocity (20 deg/s vs. 60 deg/s) using a transformed 3-down / 1-up psychophysical staircase. Results demonstrate that fast head rotations significantly sharpen latency sensitivity (JND = 32.4 ms). Crucially, the presence of a visual anchor significantly expands the latency tolerance envelope by 16.2 ms without degrading sound localization accuracy. These findings confirm Bayesian maximum likelihood integration in dynamic spatial computing and demonstrate that multimodal visual anchoring substantially relaxes physical rendering latency constraints.</p><p><i>Keywords:</i> psychoacoustics, spatial audio, motion-to-sound latency, ventriloquism effect, working memory</p><h2>Introduction</h2><p>Head movement is fundamental to auditory localization. When a listener turns their head, dynamic changes in interaural time differences (ITD) disambiguate front-back acoustic confusion (Rayleigh, 1907; Blauert, 1997). However, real-time spatialization introduces latency...</p><h2>Planned Results</h2><table><tr><th>Visual Context</th><th>Rotational Velocity</th><th>Predicted JND (ms)</th><th>Std. Error</th><th>95% CI</th></tr><tr><td>Auditory-Only</td><td>Slow (20&deg;/s)</td><td>41.2</td><td>2.1</td><td>[37.1, 45.3]</td></tr><tr><td>Auditory-Only</td><td>Fast (60&deg;/s)</td><td>32.4</td><td>1.8</td><td>[28.9, 35.9]</td></tr><tr><td>Multimodal 6-DoF</td><td>Slow (20&deg;/s)</td><td>57.8</td><td>2.8</td><td>[52.3, 63.3]</td></tr><tr><td>Multimodal 6-DoF</td><td>Fast (60&deg;/s)</td><td>48.6</td><td>2.4</td><td>[43.9, 53.3]</td></tr></table><p><i>Note.</i> JND values denote the 79.4% detection threshold obtained via the 3-down / 1-up staircase rule. CI = confidence interval.</p><h2>References</h2><p>Alais, D., &amp; Burr, D. (2004). The ventriloquist effect results from near-optimal bimodal integration. <i>Current Biology</i>, 14(3), 257–262. https://doi.org/10.1016/j.cub.2004.01.049</p><p>Lindau, A., Erbes, V., Lepa, S., Maempel, H. J., Brinkmann, F., &amp; Weinzierl, S. (2012). A spatial audio quality inventory (SAQI). <i>Acta Acustica united with Acustica</i>, 100(5), 984–994. https://doi.org/10.3813/AAA.918778</p>"
}
```

### 2. Update Manuscript Section via Granular Operation (`editDocument`)

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace",
  "operations": [
    {
      "action": "update",
      "blockId": "b_abstract_block",
      "newHtml": "<p>In spatial audio computing, motion-to-sound latency must remain below conscious detection thresholds to preserve externalization. While acoustic-only studies establish human latency JNDs around 38 ms, ecological perception involves multimodal visual-auditory integration...</p>"
    }
  ],
  "explanation": "Refine abstract terminology to emphasize externalization preservation"
}
```

### 3. Read Manuscript State (`readDocument`)

```json
{
  "instanceName": "Manuscript_Draft",
  "projectName": "Research-Workspace"
}
```

---

## Error Handling & Invariant Rules

1. **Abstract Word Count Invariant**:
   - The Abstract must contain between 150 and 250 words. Abstracts with fewer than 150 words or greater than 250 words violate APA 7 guidelines and will be flagged for revision.
2. **Strict APA Table 1 Invariant**:
   - Tables must contain zero vertical lines. Only horizontal lines at the top, below header, and at the bottom are permitted. Any table with vertical borders will fail gate review.
3. **100% Citation-to-Reference Parity**:
   - Every citation appearing in the narrative must appear in the References section with a valid DOI where applicable. No phantom references or orphan in-text citations.
4. **Table Schema Rectangularity**:
   - Ensure the `<table>` element has an identical number of `<th>` and `<td>` cells across all rows.

---

## Stage 5 Gate Exit Checklist

Before declaring Stage 5 complete and handing off to Stage 6 (`research-stage-6-critique-rollback`):

- [ ] Title Page includes formal title, authors, affiliations, and running head formatting.
- [ ] Abstract word count is verified between 150 and 250 words, followed by _Keywords:_.
- [ ] Headings conform to APA Level 1–3 conventions.
- [ ] Planned Results Table 1 adheres to the 3-horizontal-border APA rule with zero vertical lines.
- [ ] All in-text citations match the References list with complete DOIs.
- [ ] `Manuscript_Draft` document is persisted in the workspace.
- [ ] The human researcher has verified and approved the complete manuscript draft.
