# Stage 3: Hypothesis & Research Question Formulation

## Scenario Overview

- **Scenario ID**: `SCN-HCI-03`
- **Domain**: Human-Computer Interaction (HCI) & Mixed-Initiative Systems
- **Lifecycle Stage**: 3 (Hypothesis & Research Question Formulation)
- **Primary Objective**: Translate the empirical gap into formal, testable Research Questions ($RQ_1, RQ_2, RQ_3$) and directional hypotheses ($H_1, H_2, H_3$). Operationalize interaction paradigms alongside psychometric constructs (Sense of Agency, NASA-TLX) and Signal Detection Theory metrics ($d'$, $c$).
- **Participating Agent**: DeepAgent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Let's formalize our Research Questions and Hypotheses for the HCI co-authoring study.
We need to test:

1. Defect Discrimination: Does staged proposal diff review sharpen user sensitivity (d')
   in catching subtle hallucinated citations and factual inversions compared to autonomous overwrite?
2. Human Agency & Friction: Does staged diff staging preserve a high Sense of Agency (SoA)
   without imposing the task disruption and alert fatigue of modal dialogs?
3. Decision Bias: Does direct overwrite induce a reckless liberal acceptance bias (c < 0),
   and does staged diffing restore calibrated neutrality?

Draft this into a formal specification document with fully operationalized variables.
```

---

## 2. Psychometric & Interaction Operationalization Architecture

DeepAgent establishes precise definitions for all empirical factors:

| Variable Classification             | Construct Name                           | Operational Definition                                                                                  | Measurement Instrument / Metric                                                                                                                                                                                                                                     |
| :---------------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Independent Variable 1 ($IV_1$)** | AI Presentation Paradigm                 | The user interface mechanism by which DeepAgent communicates modifications.                             | 3 Levels: (A) Direct In-Place Overwrite (Agent silently mutates text/canvas), (B) Modal Blocking Dialog (Popup modal freezes UI until user accepts/rejects), (C) Non-Destructive Staged Proposal Diff (Color-coded inline diff with staged commit/reject controls). |
| **Independent Variable 2 ($IV_2$)** | Proposal Defect Injection                | Presence of subtle semantic defects embedded in agent proposals.                                        | 2 Levels: Pristine Proposal (Valid factual synthesis) vs. Defective Proposal (Contains subtle inverted causal claims or synthetic citations; 25% base rate).                                                                                                        |
| **Dependent Variable 1 ($DV_1$)**   | Defect Discrimination Sensitivity ($d'$) | The user's ability to separate true errors from valid agent improvements, independent of response bias. | $d' = \Phi^{-1}(\text{Hit Rate}) - \Phi^{-1}(\text{False Alarm Rate})$ (Signal Detection Theory).                                                                                                                                                                   |
| **Dependent Variable 2 ($DV_2$)**   | Decision Criterion / Bias ($c$)          | The user's systemic tendency to accept or reject agent proposals regardless of correctness.             | $c = -\frac{1}{2}\left[\Phi^{-1}(\text{Hit Rate}) + \Phi^{-1}(\text{False Alarm Rate})\right]$. Negative values indicate liberal complacency.                                                                                                                       |
| **Dependent Variable 3 ($DV_3$)**   | Subjective Sense of Agency (SoA)         | The user's subjective feeling of intentional control and authorship over the final manuscript.          | 5-item standardized Sense of Agency scale (Pirker et al., 2021; 7-point Likert, $\alpha = .89$).                                                                                                                                                                    |
| **Dependent Variable 4 ($DV_4$)**   | Task Completion Velocity                 | Net productive synthesis output per unit of time.                                                       | Words Per Minute (WPM) adjusted for post-hoc error correction rework.                                                                                                                                                                                               |
| **Controlled Variables**            | Domain Expertise & Task Vignette         | Control for prior academic writing ability and text complexity across trials.                           | Standardized scientific synthesis vignettes counterbalanced via Latin square.                                                                                                                                                                                       |

---

## 3. Formal Research Questions and Hypotheses

### Research Questions

- **$RQ_1$ (Defect Sensitivity Superiority)**: Does presenting AI assistance through non-destructive staged proposal diffs significantly enhance human sensitivity ($d'$) in intercepting erroneous AI mutations compared to direct in-place overwrites?
- **$RQ_2$ (Agency & Velocity Optimization)**: Can staged proposal diffs preserve high perceived human agency ($\text{SoA}$) while mitigating the workflow disruption and latency costs inherent to modal blocking dialogs?
- **$RQ_3$ (Automation Bias Calibration)**: Does direct autonomous overwriting induce an excessively liberal decision criterion ($c \ll 0$), and does staged diff presentation calibrate the user's criterion toward neutral vigilance ($c \approx 0$)?

### Falsifiable Directional Hypotheses

- **$H_1$ (Sensitivity Elevation)**: Staged proposal diffs will achieve a statistically significant higher defect discrimination index ($d'$) than direct in-place overwrites:
  $$d'_{\text{Staged Diff}} > d'_{\text{Direct Overwrite}}, \quad \Delta d' \ge 0.85, \quad p < .001$$
  _Theoretical Rationale_: Visible visual diff highlights make syntactic and semantic discrepancies salient, overcoming the visual pop-out failure characteristic of silent in-place changes.
- **$H_2$ (Agency-Friction Trade-off Resolution)**: Staged proposal diffs will maintain high Sense of Agency while achieving significantly faster Task Completion Velocity than modal dialogs:
  $$\text{SoA}_{\text{Staged Diff}} \approx \text{SoA}_{\text{Modal Dialog}} \quad \text{and} \quad \text{WPM}_{\text{Staged Diff}} > \text{WPM}_{\text{Modal Dialog}}, \quad p < .01$$
- **$H_3$ (Complacency Mitigation)**: Participants in the Direct Overwrite condition will demonstrate a strongly liberal decision criterion ($c < -0.50$), indicating automation complacency. In contrast, participants in the Staged Diff condition will maintain a balanced, neutral criterion:
  $$-0.15 \le c_{\text{Staged Diff}} \le +0.15$$

---

## 4. Tool Execution: Creating the Hypotheses Specification

The agent calls [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to persist `Formal_Hypotheses_HCI`:

```json
{
  "name": "Formal_Hypotheses_HCI",
  "project": "HCI-CoAuthoring-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [{ "text": "HCI Hypotheses: Mixed-Initiative Agency & Staged Diff Review" }]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "1. Operational Factorial Architecture" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "The experiment implements a within-subjects Latin square design crossing 3 AI Presentation Paradigms (Direct In-Place Overwrite, Modal Blocking Dialog, Staged Proposal Diff) with 2 Proposal Quality tiers (Pristine vs. Injected Defect, with a 25% defect base rate)."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "2. Directional Hypotheses" }]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H1 (Sensitivity d-prime): ", "format": 1 },
            {
              "text": "Staged proposal diffs will yield significantly higher defect discrimination sensitivity (d' > 2.0) compared to direct overwrite (d' < 1.2), preventing uninspected hallucination escape."
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H2 (Sense of Agency & Speed): ", "format": 1 },
            {
              "text": "Staged diff reviews will preserve high perceived ownership (SoA >= 5.8 on 7-point scale) while eliminating the 30% speed penalty of modal blocking popups."
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H3 (Decision Criterion Calibration): ", "format": 1 },
            {
              "text": "Direct overwrite will trigger extreme liberal automation complacency (c < -0.5), whereas staged diffing restores neutral, vigilant verification (-0.15 <= c <= 0.15)."
            }
          ]
        }
      ]
    }
  }
}
```

---

## 5. Human-Agent Co-Work Touchpoint

1. **Researcher Verification**: The researcher reviews the psychometric and Signal Detection Theory specifications in the editor pane.
2. **Defect Injection Protocol**: The researcher approves using a 25% defect base rate, ensuring that defective proposals are frequent enough to measure sensitivity without inducing abnormal cynicism.
3. **Transition**: The hypotheses are locked, enabling progression to Stage 4: Experimental Methodology & Formal Modeling.
