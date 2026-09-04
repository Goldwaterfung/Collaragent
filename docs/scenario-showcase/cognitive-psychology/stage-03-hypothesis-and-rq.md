# Stage 3: Hypothesis & Research Question Formulation

## Scenario Overview

- **Scenario ID**: `SCN-PSY-03`
- **Domain**: Cognitive Psychology
- **Lifecycle Stage**: 3 (Hypothesis & Research Question Formulation)
- **Primary Objective**: Translate the empirical gap identified in Stage 2 into formal, falsifiable Research Questions ($RQ_1, RQ_2$) and directional hypotheses ($H_1, H_2, H_3$). Rigorously operationalize all independent, dependent, and confounding variables.
- **Participating Agent**: DeepAgent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Based on our literature gap, let's author the formal Research Questions and Hypotheses section.
I want to test:

1. Does interacting with a dual-pane canvas + text editor create an extraneous split-attention
   penalty during early drafting compared to a unified single-pane text editor?
2. Does the spatial offloading benefit of the concept canvas outweigh this split-attention penalty
   when synthesis complexity (intrinsic load) exceeds a critical threshold?
3. Does staged AI diff proposals mitigate extraneous cognitive load compared to manual editing?

Format this into a structured document. Operationalize our independent and dependent variables clearly.
```

---

## 2. Theoretical Framing & Construct Operationalization

DeepAgent structures the operational definitions to ensure construct validity:

### Variable Operationalization:

| Variable Type                       | Construct Name                        | Operational Definition                                                                          | Measurement Instrument / Metric                                                                                        |
| :---------------------------------- | :------------------------------------ | :---------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| **Independent Variable 1 ($IV_1$)** | Workspace Modality                    | The visual interface layout provided for sensemaking and synthesis.                             | 3 Levels: (A) Text-Only Single Pane, (B) Dual-Pane Canvas + Text, (C) Dual-Pane Canvas + Text with Staged AI Copilot.  |
| **Independent Variable 2 ($IV_2$)** | Synthesis Complexity                  | Number of interconnected source citations and relational dependencies required to synthesize.   | 2 Levels: Low Complexity (2 sources, linear synthesis) vs. High Complexity (6 sources, multi-branch synthesis).        |
| **Dependent Variable 1 ($DV_1$)**   | Extraneous Mental Load                | Subjective attentional friction and cognitive effort expended navigating the tool.              | NASA-TLX Effort & Frustration subscales (0–100) + Paas 9-point mental effort scale.                                    |
| **Dependent Variable 2 ($DV_2$)**   | Attentional Switching Latency         | Latency overhead when shifting visual gaze and cursor focus between canvas and document pane.   | Milliseconds elapsed from pane blur to first active keydown/click in target pane (continuous telemetry).               |
| **Dependent Variable 3 ($DV_3$)**   | Schema Synthesis Quality              | Coherence, citation grounding, and structural validity of the final synthesis.                  | Blind rubric score (0–50) evaluated across 3 independent expert raters (Intraclass Correlation Coefficient $\ge .85$). |
| **Controlled Variables**            | Prior Domain Knowledge & Typist Speed | Ensure baseline typing speed and familiarity with cognitive psychology do not confound results. | Pre-test domain quiz score ($>70\%$ required) and standardized typing test (WPM covariate).                            |

---

## 3. Formal Research Questions and Hypotheses

### Research Questions

- **$RQ_1$ (Split-Attention Penalty in Low Complexity)**: Does the presence of an active 2D concept canvas introduce extraneous split-attention costs when synthesising simple, low-complexity knowledge structures?
- **$RQ_2$ (Cognitive Offloading Interaction Effect)**: Does high synthesis complexity elicit an interaction effect where the visuospatial offloading of the concept canvas significantly outperforms linear text-only editing in synthesis quality and cognitive efficiency?
- **$RQ_3$ (Mixed-Initiative Copilot Mitigation)**: Do staged AI diff proposals alleviate central executive fatigue by automating routine schema formatting?

### Falsifiable Statistical Hypotheses

- **$H_1$ (Main Effect of Modality under Low Complexity)**: Under low synthesis complexity, participants in the Dual-Pane Canvas condition will demonstrate higher extraneous mental load ($DV_1$) and longer task completion times compared to participants in the Single-Pane Text condition due to split-attention costs:
  $$H_{10}: \mu_{\text{Dual, Low}} \le \mu_{\text{Text, Low}} \quad \text{vs.} \quad H_{1A}: \mu_{\text{Dual, Low}} > \mu_{\text{Text, Low}}$$
- **$H_2$ (Crossover Interaction Effect)**: There will be a significant two-way interaction between Workspace Modality ($IV_1$) and Synthesis Complexity ($IV_2$) on Schema Synthesis Quality ($DV_3$):
  $$F(2, N - k) > F_{\text{crit}}, \quad p < .05$$
  Specifically, while text-only excels at low complexity, dual-pane canvas authoring will yield significantly superior schema quality under high complexity.
- **$H_3$ (Copilot Cognitive Efficiency)**: Participants utilizing the Staged AI Copilot condition will achieve higher Paas Cognitive Efficiency scores ($E$) than unassisted dual-pane participants:
  $$E_{\text{Copilot}} > E_{\text{Unassisted}}, \quad \text{where } E = \frac{Z_{DV_3} - Z_{DV_1}}{\sqrt{2}}$$

---

## 4. Tool Execution: Creating the Hypotheses Document

The agent executes [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to store this formal specification in the project workspace as `Formal_Hypotheses_and_RQs`:

```json
{
  "name": "Formal_Hypotheses_and_RQs",
  "project": "Cognitive-Psychology-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [{ "text": "Formal Research Questions & Directional Hypotheses" }]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "1. Operationalized Variable Architecture" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "The study employs a 3 (Workspace Modality: Text-Only vs. Dual-Pane Canvas vs. Copilot-Assisted) x 2 (Synthesis Complexity: Low vs. High) mixed factorial design. Modality serves as a between-subjects factor; complexity serves as a within-subjects factor."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "2. Hypotheses Statements" }]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H1 (Split-Attention Penalty): ", "format": 1 },
            {
              "text": "In low-complexity tasks, dual-pane canvas authoring will induce an extraneous load penalty evidenced by significantly higher Paas mental effort ratings compared to single-pane text authoring."
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H2 (Complexity Crossover Interaction): ", "format": 1 },
            {
              "text": "A significant interaction will occur between workspace modality and task complexity, such that the cognitive offloading advantage of the concept canvas becomes manifest exclusively under high-complexity knowledge synthesis."
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H3 (AI Staging Mitigation): ", "format": 1 },
            {
              "text": "The staged proposal copilot will significantly reduce extraneous load and increase overall cognitive efficiency (E) relative to manual dual-pane authoring."
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

1. **Researcher Check**: The researcher reviews the document in the central Lexical editor.
2. **Refinement of Design**: The researcher proposes changing Workspace Modality from within-subjects to between-subjects to eliminate asymmetric skill transfer between the canvas and text-only conditions.
3. **Agent Instant Update**: The agent updates the factorial specification in the document via [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).
4. **Readiness**: With clean, falsifiable hypotheses defined, the team advances to Stage 4: Experimental Methodology & Formal Modeling.
