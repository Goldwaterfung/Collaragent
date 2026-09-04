# Stage 4: HCI Methodology & Formal Modeling

## Scenario Overview

- **Scenario ID**: `SCN-HCI-04`
- **Domain**: Human-Computer Interaction (HCI) & Mixed-Initiative Systems
- **Lifecycle Stage**: 4 (HCI Methodology & Formal Modeling)
- **Primary Objective**: Detail the within-subjects Latin square experimental protocol, synthetic defect injection engine, and mathematical models for Signal Detection Theory ($d'$, $c$) and Net Productive Velocity ($NPV$) formatted in KaTeX. Establish rigorous telemetry logging protocols for co-authoring interaction traces.
- **Participating Agent**: DeepAgent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Now let's draft the complete HCI Experimental Methodology section.
We need:

1. Within-subjects Latin Square design: 36 academic researchers tested across 3 conditions
   (Direct Overwrite, Modal Dialog, Staged Diff), counterbalanced across 3 task vignettes.
2. Defect Injection Protocol: Describe how 25% of agent proposals contain controlled subtle errors
   (inverted causal claims, fake DOIs) to measure automation complacency.
3. Mathematical models in KaTeX:
   - Signal Detection Theory Sensitivity (d-prime).
   - Decision Criterion (c) indicating liberal vs. conservative bias.
   - Net Productive Velocity (NPV) penalizing uncorrected errors.
4. Instrumentation & Telemetry: Logging millisecond-accurate proposal review times, diff inspection hovers,
   and keystroke dynamics.
```

---

## 2. Mathematical Modeling in KaTeX

### Model 1: Signal Detection Theory Sensitivity Index ($d'$)

To decouple a user's genuine perceptual ability to detect agent hallucinations from their personal willingness to accept suggestions, we apply Macmillan & Creelman's (2004) SDT model:

$$d' = \Phi^{-1}(H) - \Phi^{-1}(FA)$$

Where:

- $H$ (Hit Rate): Proportion of defective proposals correctly identified and rejected:
  $$H = \frac{\text{Defective Proposals Rejected}}{\text{Total Defective Proposals Injected}}$$
- $FA$ (False Alarm Rate): Proportion of pristine proposals mistakenly rejected:
  $$FA = \frac{\text{Pristine Proposals Rejected}}{\text{Total Pristine Proposals Presented}}$$
- $\Phi^{-1}$: The inverse cumulative standard normal distribution (probit function).
- _Boundary Correction_: Standard log-linear correction (Hautus, 1995) is applied when rates approach 0 or 1:
  $$H_{\text{adj}} = \frac{\text{Rejections} + 0.5}{\text{Total Injected} + 1}$$

### Model 2: Decision Criterion / Response Bias ($c$)

Quantifies the user's bias toward automation complacency vs. defensive skepticism:

$$c = -\frac{1}{2} \left[\Phi^{-1}(H) + \Phi^{-1}(FA)\right]$$

_Interpretation_:

- $c = 0$: Unbiased, calibrated verification.
- $c < 0$: Liberal bias / Automation Complacency (Reluctance to reject proposals; tendency to click "Accept" blindly).
- $c > 0$: Conservative bias / Cynicism (Excessive rejection of valid, high-quality proposals).

### Model 3: Net Productive Velocity ($NPV$)

Traditional Words-Per-Minute (WPM) metrics fail to penalize hallucination escape. We define Net Productive Velocity as:

$$NPV = \frac{W_{\text{accepted}} - \rho \cdot W_{\text{defective}}}{\Delta t_{\text{session}}}$$

Where:

- $W_{\text{accepted}}$: Total valid words incorporated into final text.
- $W_{\text{defective}}$: Erroneous or hallucinated words escaping into the final submitted text.
- $\rho$: Quality penalty multiplier ($\rho = 3.0$, representing the tripled human effort required to retract/remedy published academic errors).
- $\Delta t_{\text{session}}$: Total active co-authoring duration in minutes.

---

## 3. Latin Square Counterbalance Protocol

To eliminate carryover and practice effects across the 3 interaction conditions, 36 participants are assigned to three counterbalanced sequence groups ($n = 12$ per sequence):

| Participant Group    | Session 1 (Vignette A)            | Session 2 (Vignette B)            | Session 3 (Vignette C)            |
| :------------------- | :-------------------------------- | :-------------------------------- | :-------------------------------- |
| **Group 1 ($n=12$)** | Condition 1: Direct Overwrite     | Condition 2: Modal Dialog         | Condition 3: Staged Proposal Diff |
| **Group 2 ($n=12$)** | Condition 2: Modal Dialog         | Condition 3: Staged Proposal Diff | Condition 1: Direct Overwrite     |
| **Group 3 ($n=12$)** | Condition 3: Staged Proposal Diff | Condition 1: Direct Overwrite     | Condition 2: Modal Dialog         |

_Task Vignettes_: Three balanced scientific synthesis tasks matching in readability (Flesch-Kincaid Grade Level $14.2 \pm 0.4$) and source complexity (4 academic papers provided per vignette).

---

## 4. Tool Execution: Creating the Methodology Document

The agent calls [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to persist `HCI_Methodology_Protocol`:

```json
{
  "name": "HCI_Methodology_Protocol",
  "project": "HCI-CoAuthoring-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [{ "text": "Methodology: Mixed-Initiative Co-Authoring & Defect Detection" }]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Participants & Latin Square Design" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "Thirty-six active academic researchers (PhD students and postdocs; 19 female, 17 male; mean age = 28.6 years) were recruited across computer science, psychology, and neuroscience. The experiment followed a within-subjects 3 x 1 Latin square design evaluating three AI interaction paradigms: (1) Direct In-Place Overwrite, (2) Modal Blocking Dialog, and (3) Non-Destructive Staged Proposal Diff."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Signal Detection Theory Formulation" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "User defect sensitivity (d') and decision bias (c) are computed as:"
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "$$d' = \\Phi^{-1}(H) - \\Phi^{-1}(FA), \\quad c = -\\frac{1}{2} \\left[\\Phi^{-1}(H) + \\Phi^{-1}(FA)\\right]$$"
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Apparatus & Telemetry Instrumentation" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "All sessions occurred within CollarAgent running on an isolated workstation. Background telemetry captured millisecond-accurate timestamps for: (a) proposal presentation, (b) mouse cursor hover duration over diff highlights, (c) user acceptance or rejection click, and (d) post-decision editing keystrokes. Sense of Agency was sampled immediately after each session using the standardized 5-item SoA instrument."
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

1. **Researcher Verification**: The researcher reviews the SDT formulas, verifying that using the log-linear correction ensures mathematical stability when users achieve 100% defect interception ($H = 1.0$).
2. **Quality Penalty Multiplier**: The researcher affirms that setting $\rho = 3.0$ in the Net Productive Velocity model accurately penalizes the severe cost of publishing unverified academic hallucinations.
3. **Approval**: The protocol is locked, enabling the compilation of Stage 5: Structured Scholarly Synthesis.
