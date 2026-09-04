# Stage 2: Literature Retrieval & Gap Analysis

## Scenario Overview

- **Scenario ID**: `SCN-PSY-02`
- **Domain**: Cognitive Psychology
- **Lifecycle Stage**: 2 (Literature Retrieval & Gap Analysis)
- **Primary Objective**: Delegate an empirical literature review to a specialized research subagent, targeting foundational working memory models, dual-task interference paradigms, and split-attention effects in multimodal computing environments. Synthesize findings into a comparative evidence matrix and isolate an unaddressed research gap.
- **Participating Agent**: DeepAgent delegating to subagent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md) skill.
- **Workspace Tools Used**: [`internetSearch`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/SearchTools.ts#L14), [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820), [`writeGraph`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L969).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Now that we have mapped the systems architecture on the canvas, let's search and synthesize the
empirical literature. Specifically, look into:

1. Sweller's Split-Attention Effect in dual-representation interfaces.
2. Baddeley's Dual-Task interference paradigms between visuospatial and phonological tasks.
3. Paas & Van Merriënboer's cognitive efficiency metrics.

Identify what previous studies have proven, where their experimental setups were limited,
and synthesize this into a literature comparison matrix document. Then link the verified citations
back into our canvas graph.
```

---

## 2. Agent Subagent Delegation & Search Trajectory

DeepAgent delegates the literature acquisition to the `apa-research-execution-specialist` subagent. The subagent follows its **Linear Thinking Mode** (research $\rightarrow$ outline $\rightarrow$ draft $\rightarrow$ cite):

### Search Query Trajectory:

1. `internetSearch({ query: "Sweller split attention effect dual visual text interface empirical study" })`
2. `internetSearch({ query: "Baddeley visuospatial sketchpad phonological loop dual-task interference paradigms" })`
3. `internetSearch({ query: "Paas Van Merrienboer mental effort performance cognitive efficiency measurement" })`

### Key Empirical Findings Extracted:

- **Sweller & Chandler (1994); Mayer & Moreno (1998)**: When visual and textual information are physically separated, learners must engage in extraneous visual search, dividing the central executive's attentional resources and diminishing schema acquisition.
- **Baddeley, Grant, Wight, & Thomson (1975)**: Tracking a moving light (visuospatial task) severely disrupted performance on the spatial Brooks matrix task, but had minimal effect on verbal recall. Conversely, an articulatory suppression task impaired verbal memory without degrading spatial tracking.
- **Paas, Tuovinen, Tabbers, & Van Gerven (2003)**: Proposed standardizing cognitive efficiency ($E$) as the standardized distance between z-scored performance ($P$) and z-scored subjective mental effort ($R$):
  $$E = \frac{Z_P - Z_R}{\sqrt{2}}$$

### Identified Research Gap:

Prior split-attention research primarily evaluated **passive learning material** (e.g., viewing an annotated diagram next to textbook paragraphs). **Virtually zero empirical studies have examined active co-authoring environments** where the user concurrently manipulates an interactive 2D node-link graph while drafting scholarly text with a mixed-initiative AI copilot.

---

## 3. Tool Execution: Creating the Literature Matrix Document

The agent invokes [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to generate a scholarly document titled `Literature_Review_Matrix`:

```json
{
  "name": "Literature_Review_Matrix",
  "project": "Cognitive-Psychology-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [{ "text": "Empirical Foundations: Cognitive Load & Dual-Task Paradigms" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "This matrix synthesizes empirical precedents in cognitive load theory, working memory resource competition, and multimedia representation to establish our theoretical baseline."
            }
          ]
        },
        {
          "type": "table",
          "children": [
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Study (Citation)" }] },
                { "type": "tablecell", "children": [{ "text": "Theoretical Focus" }] },
                { "type": "tablecell", "children": [{ "text": "Experimental Paradigm" }] },
                { "type": "tablecell", "children": [{ "text": "Key Findings" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Critical Limitation / Research Gap" }]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Sweller & Chandler (1994)" }] },
                { "type": "tablecell", "children": [{ "text": "Split-Attention Effect" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Static diagram + separate text box instructions" }]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Integrated text-diagram presentation reduced extraneous load by 35%."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Only tested passive consumption of static instructional sheets; no bidirectional authoring."
                    }
                  ]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Baddeley et al. (1975)" }] },
                { "type": "tablecell", "children": [{ "text": "Working Memory Modality" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Pursuit rotor pursuit tracking + Brooks spatial matrix" }]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Cross-modal tasks (spatial + verbal) exhibited negligible interference compared to intra-modal."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Artificial laboratory motor tasks; lacks ecological validity for digital knowledge work."
                    }
                  ]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Paas & Van Merriënboer (1993)" }] },
                { "type": "tablecell", "children": [{ "text": "Cognitive Efficiency" }] },
                {
                  "type": "tablecell",
                  "children": [
                    { "text": "9-point Paas mental effort scale + geometry problem-solving" }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Defined 2D mathematical vector space combining subjective effort with objective test score."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Relies on post-hoc self-report; lacks continuous real-time latency telemetry."
                    }
                  ]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Mayer & Moreno (2003)" }] },
                { "type": "tablecell", "children": [{ "text": "Multimedia Load Nine Ways" }] },
                {
                  "type": "tablecell",
                  "children": [
                    { "text": "Dual-channel multimedia narration vs. onscreen captioning" }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Offloading visual text to acoustic narration prevented visuospatial channel bottleneck."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Assumed one-way broadcast; did not model user-driven graph exploration."
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
```

---

## 4. Closing the Loop: Updating the Canvas Graph

In compliance with the **Feedback Loop Mandate** in [`apa-research-execution-specialist/SKILL.md`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md#L29), newly verified empirical literature citations are projected back onto the Concept Canvas using [`writeGraph`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L969):

```json
{
  "project": "Cognitive-Psychology-Study",
  "mode": "merge",
  "graph": {
    "relationships": [
      {
        "source": "[CLT] Cognitive Load Types (Sweller)",
        "target": "Sweller & Chandler (1994)",
        "label": "grounded by"
      },
      {
        "source": "[WM] Working Memory Subsystems",
        "target": "Baddeley et al. (1975)",
        "label": "validated by"
      },
      {
        "source": "[OUT] Cognitive Outcomes",
        "target": "Paas & Van Merriënboer (1993)",
        "label": "measured via Z-vectors"
      },
      {
        "source": "Infinite Concept Canvas (2D Spatial Graphs)",
        "target": "UNEXPLORED RESEARCH GAP: Active Dual-Authoring",
        "label": "exposes empirical boundary"
      }
    ]
  }
}
```

---

## 5. Human-Agent Co-Work Touchpoint

1. **Researcher Verification**: The researcher reviews the newly populated table inside the `Literature_Review_Matrix` document.
2. **Gap Validation**: The researcher verifies that highlighting _"active bidirectional authoring vs. passive diagram viewing"_ is a publishable, novel angle for CHI / Cognitive Science conferences.
3. **Transition**: The team agrees on the exact empirical gap and proceeds to Stage 3 to formulate formal, directional hypotheses.
