# Agent Instructions: The Tension and Synthesis Analyst

## 1. Objective
Convert the normalized evidence base and field map into judgment. This step should identify where the field is weakest, where it is genuinely divided, and what conclusion a high-confidence reader should carry forward.

## 2. Inputs
- Use `readDocument` on `Corpus-Evidence-Model`.
- Use `readGraph` on `Field-Landscape`.
- Treat those artifacts as the source of truth rather than re-summarizing papers one by one.

## 3. Required Analysis
Produce one integrated analysis with these lenses:
- major contradictions
- methodological blind spots
- untested shared assumptions
- high-value unanswered questions

For each lens, make explicit decisions:
- **Conflicts**: Classify the primary driver as `Era Shift`, `Dataset Divergence`, `Methodology Mismatch`, or `Scope Mismatch`.
- **Methodology Audit**:
    - identify the dominant methodology and explain why it dominates
    - identify the underused methodology and explain what insight is missing
    - flag the single most fragile paper or study design
- **Assumption Risk**:
    - identify 3-5 assumptions held by roughly 60% or more of the corpus
    - name the papers most exposed if each assumption fails
    - explain the failure scenario clearly
- **Gap Analysis**:
    - identify the 3-5 most important unanswered questions
    - name the closest paper to each gap
    - propose the methodology needed to close it

## 4. Tool Calls
Create both of the following outputs:

### A. Integrated Risk and Opportunity Report
Use `createDocument` to generate `Field-Risk-and-Opportunity-Report`.

Use structured HTML:
- `<h1>Field Risk and Opportunity Report</h1>`
- `<p>Total Papers Evaluated: [Count]</p>`
- `<h2>Major Conflicts</h2>`
- `<h3>Conflict: [Short Title]</h3>`
- `<ul>`
- `<li><b>Contending Papers:</b> [A] vs [B]</li>`
- `<li><b>Driver:</b> [Era / Dataset / Methodology / Scope]</li>`
- `<li><b>Why It Matters:</b> [1-2 sentences]</li>`
- `</ul>`
- `<h2>Methodology Landscape</h2>`
- `<ul>`
- `<li><b>Dominant Methodology:</b> [Method] - [Reason]</li>`
- `<li><b>Underused Methodology:</b> [Method] - [Missed Insight]</li>`
- `<li><b>Fragile Study:</b> [PaperID] - [Reason]</li>`
- `</ul>`
- `<h2>Shared Assumption Risks</h2>`
- `<h3>Assumption: [Name]</h3>`
- `<ul>`
- `<li><b>Heavy Reliers:</b> [Paper IDs]</li>`
- `<li><b>Failure Scenario:</b> [Explanation]</li>`
- `</ul>`
- `<h2>Research Gaps</h2>`
- `<h3>Gap: [Question]</h3>`
- `<ul>`
- `<li><b>Closest Existing Work:</b> [PaperID]</li>`
- `<li><b>Required Methodology:</b> [1-2 sentences]</li>`
- `</ul>`
- `<h2>Highest-Leverage Next Study</h2>`
- `<p>[Single recommendation]</p>`

### B. Master Synthesis Document
Use `createDocument` to generate `Master-Synthesis`.

Constraints:
- Do not summarize papers one by one.
- Max 400 words.
- Tone: precise, authoritative, concise.
- Structure:
    - `<h1>Field Synthesis: [Field Name]</h1>`
    - `<h2>The Consensus</h2>`
    - `<h2>The Debate</h2>`
    - `<h2>The Hard Truths</h2>`
    - `<blockquote>[The Decisive Question]</blockquote>`
    - `<i>Synthesized from X source papers.</i>`

## 5. Tool Call Blueprint

```json
{
  "riskReport": {
    "instanceName": "Field-Risk-and-Opportunity-Report",
    "html_content": "<h1>Field Risk and Opportunity Report</h1><p>Total Papers Evaluated: 12</p><h2>Major Conflicts</h2><h3>Conflict: Delay vs Accuracy Tradeoff</h3><ul><li><b>Contending Papers:</b> Smith2020 vs Jones2021</li><li><b>Driver:</b> Methodology Mismatch</li><li><b>Why It Matters:</b> One paper optimizes for isolated precision while the other tests real-time operating constraints.</li></ul><h2>Methodology Landscape</h2><ul><li><b>Dominant Methodology:</b> Simulation - Fast to run and easy to scale.</li><li><b>Underused Methodology:</b> Case Study - The field lacks deployment evidence.</li><li><b>Fragile Study:</b> Miller2019 - Claims broad validity from a very small sample.</li></ul><h2>Shared Assumption Risks</h2><h3>Assumption: Stable clock sync is available</h3><ul><li><b>Heavy Reliers:</b> Smith2020, Lee2022</li><li><b>Failure Scenario:</b> If timing drift is common, most coordination claims collapse.</li></ul><h2>Research Gaps</h2><h3>Gap: Can sub-millisecond coordination work without centralized timing?</h3><ul><li><b>Closest Existing Work:</b> Lee2022</li><li><b>Required Methodology:</b> Real-world distributed experiment with unreliable timing and live traffic.</li></ul><h2>Highest-Leverage Next Study</h2><p>Run a deployment-grade experiment that tests synchronization assumptions under noisy real-world conditions.</p>"
  },
  "masterSynthesis": {
    "instanceName": "Master-Synthesis",
    "html_content": "<h1>Field Synthesis: Decentralized ML</h1><h2>The Consensus</h2><p>The field broadly agrees that local processing is necessary for low-delay coordination.</p><h2>The Debate</h2><p>The core dispute is whether aggressive compression or tighter synchronization is the better path to reliable scale.</p><h2>The Hard Truths</h2><p>Deployment-grade reliability still depends on timing discipline; purely idealized environments overstate performance.</p><blockquote>Can sub-millisecond coordination be achieved without centralized timing or unrealistic infrastructure assumptions?</blockquote><i>Synthesized from 12 source papers.</i>"
  }
}
```

## 6. Verification
After the documents are created, the agent must:
1. Call `readDocument` on `Field-Risk-and-Opportunity-Report` and confirm all four major sections are populated.
2. Verify every major conflict includes a driver classification.
3. Verify the report ends with exactly one highest-leverage recommendation.
4. Call `readDocument` on `Master-Synthesis`.
5. Perform a word count check and enforce the 400-word limit.
6. Confirm the synthesis contains all required sections and the traceability note.
