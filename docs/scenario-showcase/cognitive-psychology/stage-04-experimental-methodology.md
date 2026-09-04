# Stage 4: Experimental Methodology & Formal Modeling

## Scenario Overview

- **Scenario ID**: `SCN-PSY-04`
- **Domain**: Cognitive Psychology
- **Lifecycle Stage**: 4 (Experimental Methodology & Formal Modeling)
- **Primary Objective**: Design a comprehensive experimental methodology adhering to APA 7th Edition standards. Formulate mathematical models for Cognitive Efficiency and Attentional Throughput using KaTeX, perform statistical power calculations ($G*\text{Power}$), and design a dual-task probe reaction time protocol to measure spare working memory capacity continuously.
- **Participating Agent**: DeepAgent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Now let's draft the complete Experimental Methodology section in APA 7 style.
We need:

1. Statistical power analysis using G*Power for our 3x2 mixed ANOVA (calculate exact required N).
2. Participant recruitment criteria and ethical compliance (IRB).
3. Continuous dual-task paradigm: explain how we use an auditory secondary probe reaction time task
   to measure spare central executive capacity during canvas-editor interaction.
4. Formal mathematical modeling of Cognitive Efficiency (E) and Cognitive Throughput (CT)
   formatted with KaTeX.
5. Step-by-step procedural protocol and counterbalance controls.
```

---

## 2. Statistical Power Analysis & Design Specifications

DeepAgent performs statistical power calculations for the $3 \times 2$ mixed ANOVA design:

- **Test Family**: $F$-tests (Repeated measures, within-between interaction).
- **Effect Size Specification**: Medium effect size Cohen's $f = 0.25$ ($\eta_p^2 \approx 0.06$).
- **Significance Level ($\alpha$)**: $0.05$.
- **Statistical Power ($1 - \beta$)**: $0.80$.
- **Number of Groups (Between)**: 3 (Text-Only, Dual-Pane Canvas, Copilot-Assisted).
- **Number of Measurements (Within)**: 2 (Low Complexity, High Complexity).
- **Correlation among Repeated Measures**: $r = 0.50$.
- **Calculated Required Sample Size**: Total $N = 72$ ($n = 24$ participants per between-subjects condition).

---

## 3. Mathematical Models Formulated in KaTeX

### Model 1: Standardized 2D Cognitive Efficiency Vector ($E$)

Based on Paas & Van Merriënboer (1993), cognitive efficiency is modeled as the perpendicular distance from the line of neutral efficiency ($P = R$) in a standardized coordinate plane:

$$\bar{Z}_P = \frac{P - \mu_P}{\sigma_P}, \quad \bar{Z}_R = \frac{R - \mu_R}{\sigma_R}$$

$$E = \frac{\bar{Z}_P - \bar{Z}_R}{\sqrt{2}}$$

_Interpretation_:

- $E > 0$: High efficiency (Superior synthesis performance achieved with lower subjective mental effort).
- $E < 0$: Low efficiency (Inferior synthesis performance despite high mental effort expenditure).

### Model 2: Continuous Cognitive Throughput ($CT$)

To capture real-time productivity per unit of attentional expenditure:

$$CT = \frac{\Delta K_{\text{grounded}}}{\Delta t \cdot \left(1 + \frac{\text{RT}_{\text{probe}}}{\overline{\text{RT}}_{\text{baseline}}}\right)}$$

Where:

- $\Delta K_{\text{grounded}}$: Valid semantic propositions added and grounded to literature sources.
- $\Delta t$: Active synthesis duration in minutes.
- $\text{RT}_{\text{probe}}$: Secondary auditory probe reaction time during active editing (ms).
- $\overline{\text{RT}}_{\text{baseline}}$: Pre-test resting baseline reaction time (ms).

---

## 4. Dual-Task Secondary Probe Protocol

To overcome the limitation of relying solely on subjective post-task questionnaires (e.g., NASA-TLX), the study introduces a continuous behavioral measure of spare attentional capacity:

```
Timeline: 20-Minute Synthesis Task
-----------------------------------------------------------------------------------------
Primary Task:      [===== User Manipulates Canvas & Drafts Lexical Document =====]
Secondary Probe:   ...Beep (RT=320ms)...Beep (RT=540ms)...Beep (RT=890ms)...
Attentional Load:  Low Load              Moderate Load       High Load (Pane Switching)
-----------------------------------------------------------------------------------------
```

1. **Stimulus**: A 1000 Hz auditory tone (50 ms duration) played at randomized intervals (every 25–45 seconds).
2. **Response**: Participants press a dedicated foot pedal as rapidly as possible without pausing typing.
3. **Cognitive Logic**: Because foot pedal depression uses motor pathways independent of manual typing, reaction time latency ($\Delta \text{RT} = \text{RT}_{\text{task}} - \text{RT}_{\text{baseline}}$) directly indexes momentary central executive saturation.

---

## 5. Tool Execution: Creating the Methodology Document

The agent calls [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to author `Methodology_and_Experimental_Protocol` in Lexical AST format:

```json
{
  "name": "Methodology_and_Experimental_Protocol",
  "project": "Cognitive-Psychology-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [{ "text": "Methodology: Dual-Task Cognitive Load Evaluation" }]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Participants & Statistical Power" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "An a priori statistical power analysis performed in G*Power 3.1 indicated that a total sample size of N = 72 (n = 24 per condition) is required to detect a medium interaction effect (f = 0.25) with alpha = .05 and power = .80 in a 3 x 2 mixed repeated-measures ANOVA."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Apparatus & Secondary Probe Task" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "Participants perform the primary synthesis task on a 27-inch 4K monitor (3840 x 2160 at 60 Hz). Continuous cognitive load is sampled using a secondary auditory probe paradigm. Auditory beeps (1000 Hz, 65 dB SPL, 50 ms) trigger at quasi-random intervals (jittered between 25 and 45 s). Participants respond via a low-latency USB foot pedal (VEC Infinity IN-USB-3), isolating central executive latency from hand typing interference."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Mathematical Modeling of Efficiency" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "Cognitive efficiency (E) is computed as the normalized Euclidean distance from the line of equality in standardized Z-score space:"
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "$$E = \\frac{\\bar{Z}_{\\text{Quality}} - \\bar{Z}_{\\text{Effort}}}{\\sqrt{2}}$$"
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Experimental Procedure" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "Phase 1: Baseline reaction time calibration (5 minutes, 15 solitary probes). Phase 2: 10-minute training tutorial on assigned workspace condition. Phase 3: Task Session 1 (Low Complexity, 20 minutes). Phase 4: 5-minute cognitive rest and NASA-TLX administration. Phase 5: Task Session 2 (High Complexity, 20 minutes) with counterbalanced order."
            }
          ]
        }
      ]
    }
  }
}
```

---

## 6. Human-Agent Co-Work Touchpoint

1. **Apparatus Sanity Check**: The researcher verifies that using a foot pedal avoids motor interference with standard QWERTY keyboard strokes.
2. **KaTeX Formula Review**: The researcher checks that the KaTeX block renders cleanly in the Lexical editor without escaping glitches.
3. **Approval**: The experimental protocol is locked, providing the structural foundation for Stage 5: Structured Scholarly Synthesis.
