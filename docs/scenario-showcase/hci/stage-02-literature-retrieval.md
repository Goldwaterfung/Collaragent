# Stage 2: Literature Retrieval & Gap Analysis

## Scenario Overview

- **Scenario ID**: `SCN-HCI-02`
- **Domain**: Human-Computer Interaction (HCI) & Mixed-Initiative Systems
- **Lifecycle Stage**: 2 (Literature Retrieval & Gap Analysis)
- **Primary Objective**: Execute an empirical literature search targeting mixed-initiative user interfaces, automation complacency in AI-assisted decision making, and interactive diff review paradigms. Synthesize prior findings into a comparative evidence matrix and isolate the novel research gap in bidirectional document/canvas co-authoring.
- **Participating Agent**: DeepAgent delegating to subagent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`internetSearch`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/SearchTools.ts#L14), [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`writeGraph`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L969).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Search and synthesize the empirical HCI literature on human-AI co-authoring and automation bias.
Focus on:

1. Horvitz's foundational mixed-initiative design principles.
2. Parasuraman & Manzey's empirical studies on automation complacency and defect omission errors.
3. Recent CHI/UIST studies on interactive diffs, AI inline autocomplete, and sense of agency.

Synthesize what has been tested, where prior paradigms fall short, and isolate the research gap
concerning staged proposal diffs across multi-pane visual-document workspaces.
Compile this into a structured document and update our canvas graph.
```

---

## 2. Agent Subagent Search Trajectory

DeepAgent delegates the literature acquisition to the `apa-research-execution-specialist` subagent:

1. `internetSearch({ query: "Horvitz mixed initiative user interfaces principles uncertainty direct manipulation" })`
2. `internetSearch({ query: "Parasuraman Manzey automation bias complacency decision support errors CHI" })`
3. `internetSearch({ query: "AI co-writing sense of agency diff inspection staged proposal UIST CHI" })`

### Key Empirical Findings Extracted:

- **Horvitz (1999)**: Defined 12 core principles for mixed-initiative interaction, establishing that intelligent assistants must model user goals under uncertainty, provide non-invasive mechanisms for reviewing recommendations, and support fluid handover to direct manipulation.
- **Parasuraman & Manzey (2010); Skitka et al. (1999)**: When human operators work with automated systems over extended durations, they exhibit _automation complacency_ (failing to notice when the automated tool makes an error) and _automation bias_ (treating automated output as an authoritative heuristic rather than a hypothesis to be verified).
- **Buschek et al. (2021); Clark et al. (2018)**: Evaluated generative text suggestions in creative writing. Found that inline tab-completion increases typing speed but significantly biases author vocabulary and narrative direction toward model priors, eroding perceived authorship.
- **Glassman et al. (2015); Fast et al. (2018)**: Demonstrated that modal confirmation dialogs interrupt task attention and elicit habituated dismissals ("rubber-stamping"). In contrast, non-blocking side-by-side diff comparisons dramatically improve error identification in code review and data wrangling.

### Identified Research Gap:

Current AI co-authoring interfaces operate almost exclusively through either **monolithic chat sidebars** (where users copy-paste raw markdown text) or **inline token autocomplete** (Tab-to-accept). **No prior empirical HCI study has investigated a non-destructive staged proposal diff architecture** that unifies structural edits across both an interactive 2D concept canvas (DAG node-link mutations) and a scholarly 1D document engine (Lexical AST block updates) to mitigate automation complacency.

---

## 3. Tool Execution: Creating the Literature Matrix Document

The agent invokes [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to persist `Literature_Review_Matrix_HCI`:

```json
{
  "name": "Literature_Review_Matrix_HCI",
  "project": "HCI-CoAuthoring-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [
            { "text": "Empirical Foundations: Mixed-Initiative Agency & Automation Bias" }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "This synthesis evaluates foundational and contemporary research in mixed-initiative interaction, human agency, automation complacency, and interactive diff mechanisms."
            }
          ]
        },
        {
          "type": "table",
          "children": [
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Investigation (Citation)" }] },
                { "type": "tablecell", "children": [{ "text": "Interaction Paradigm" }] },
                { "type": "tablecell", "children": [{ "text": "Key Findings" }] },
                { "type": "tablecell", "children": [{ "text": "Observed Failure Mode" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Unaddressed Boundary / Research Gap" }]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Horvitz (1999)" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Foundational mixed-initiative theory" }]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Established cost-benefit threshold for AI intervention and dialog initiation."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    { "text": "Premature action execution without uncertainty modeling." }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Theoretical framework; predated large language models and multi-pane desktop IDEs."
                    }
                  ]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Parasuraman & Manzey (2010)" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Human supervisory control of automation" }]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Complacency reduces defect detection by 30-50% under routine operation."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    { "text": "Uncritical acceptance of invalid system recommendations." }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Tested flight navigation and industrial process control; did not evaluate academic text authoring."
                    }
                  ]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Buschek et al. (2021)" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Inline predictive text suggestions" }]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Users write faster but experience significantly diminished Sense of Agency."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    { "text": "Subconscious steering of user thoughts toward LLM priors." }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Only studied linear sentence completion; ignored high-level structural document refactoring."
                    }
                  ]
                }
              ]
            },
            {
              "type": "tablerow",
              "children": [
                { "type": "tablecell", "children": [{ "text": "Fast et al. (2018)" }] },
                {
                  "type": "tablecell",
                  "children": [{ "text": "Iris: Conversational data science assistant" }]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Side-by-side visual diffs preserved user context better than modal alerts."
                    }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    { "text": "Context switching between chat console and code editor." }
                  ]
                },
                {
                  "type": "tablecell",
                  "children": [
                    {
                      "text": "Restricted to single script files; did not bridge 2D graph canvases with scholarly manuscripts."
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

The subagent connects the verified citations and the isolated gap to the workspace canvas via [`writeGraph`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L969):

```json
{
  "project": "HCI-CoAuthoring-Study",
  "mode": "merge",
  "graph": {
    "relationships": [
      {
        "source": "Mixed-Initiative Cooperative Handshake",
        "target": "Horvitz (1999)",
        "label": "governed by principles"
      },
      {
        "source": "Automation Complacency & Bias",
        "target": "Parasuraman & Manzey (2010)",
        "label": "quantified by"
      },
      {
        "source": "Non-Destructive Staged Proposal Diff",
        "target": "RESEARCH GAP: Interleaved Graph-Document Staging",
        "label": "proves novel paradigm"
      }
    ]
  }
}
```

---

## 5. Human-Agent Co-Work Touchpoint

1. **Researcher Verification**: The researcher reviews the literature matrix and confirms that contrasting **Direct Autonomous Overwrite**, **Modal Dialogs**, and **Staged Proposal Diffs** will directly address current debates in ACM CHI on agentic interfaces.
2. **Gap Endorsement**: The team establishes that measuring **Signal Detection Theory ($d'$)** under synthetic defect injection will provide a mathematically defensible evaluation of automation bias.
3. **Transition**: The team advances to Stage 3: Hypothesis & Research Question Formulation.
