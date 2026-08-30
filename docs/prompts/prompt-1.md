# Agent Instructions: The Evidence and Landscape Builder

## 1. Objective
Build the research foundation in one pass. Extract normalized evidence from the corpus, then turn that evidence into a field map that later steps can analyze without re-reading every paper from scratch.

## 2. Corpus Extraction
- **Input**: An array of `papers[]` containing `title`, `authors`, `year`, `shortId`, and `abstract/content`.
- **Extract for every paper**:
    - **Core Claim**: One sentence, high impact, maximum 200 characters.
    - **Primary Methodology**: Choose exactly one label: `Survey`, `Experiment`, `Simulation`, `Meta-Analysis`, `Case Study`, or `Theory`.
    - **Key Assumptions**: 2-5 premises the paper relies on.
    - **Limitations / Open Problems**: What the paper cannot answer.
    - **Key Concepts**: 1-3 concepts that matter for the field-level model.
    - **Citations**: Which other papers in the corpus it cites or builds on.
    - **Direct Contradictions**: Any paper in the corpus it clearly disputes.

## 3. Normalization and Structural Mapping
Before calling tools, consolidate the extraction into a single shared evidence model and field structure:
- **One Evidence Block per Paper**: Every paper must appear exactly once.
- **Consistent Labels**: Reuse the same assumption and concept names across papers when they mean the same thing.
- **Ambiguity Handling**: If a field cannot be extracted confidently, write `Needs Review` instead of guessing.
- **Cross-Paper Signals**: Compute three shared lists:
    - recurring assumptions
    - recurring concepts
    - methodology distribution across the corpus
- **Root Structure**:
    - **Central Node**: `Field: [Topic Name]`
    - **Assumption Hubs**: Shared premises that anchor clusters.
    - **Concept Branches**: Foundational concepts that cut across hubs.
    - **Paper Leaves**: Individual papers attached to their strongest hub.
- **Semantic Edge Labels**:
    - `cites`
    - `contradicts`
    - `shares_assumption`
    - `refines`
    - `challenges`

## 4. Tool Calls
Create both of the following outputs:

### A. Evidence Model Document
Use `createDocument` to generate `Corpus-Evidence-Model`.

Use semantic HTML:
- `<h1>Corpus Evidence Model</h1>`
- `<p>Total Papers Parsed: [Count]</p>`
- `<h2>Paper: [ShortId]</h2>`
- `<ul>`
- `<li><b>Core Claim:</b> [Sentence]</li>`
- `<li><b>Methodology:</b> [Label]</li>`
- `<li><b>Assumptions:</b> [Comma-separated list]</li>`
- `<li><b>Limitations:</b> [1-2 sentences]</li>`
- `<li><b>Key Concepts:</b> [Comma-separated list]</li>`
- `<li><b>Cites:</b> [Paper IDs or None]</li>`
- `<li><b>Contradicts:</b> [Paper IDs or None]</li>`
- `</ul>`
- `<h2>Cross-Paper Signals</h2>`
- `<ul>`
- `<li><b>Shared Assumptions:</b> [...]</li>`
- `<li><b>Recurring Concepts:</b> [...]</li>`
- `<li><b>Methodology Distribution:</b> [...]</li>`
- `</ul>`

### B. Field Graph
Use `writeGraph` to generate `Field-Landscape`.

Required configuration:
- `instanceName`: `Field-Landscape`
- `direction`: `RADIAL`
- `mode`: `replace`
- Prefer nested `root` structure over a flat node list.

If the corpus has 2-3 especially important concepts, also create one `writeMindMap` canvas per concept:
- `instanceName`: `Lineage-[ConceptName]`
- `direction`: `TD`

## 5. Tool Call Blueprint

```json
{
  "document": {
    "instanceName": "Corpus-Evidence-Model",
    "html_content": "<h1>Corpus Evidence Model</h1><p>Total Papers Parsed: 12</p><h2>Paper: Smith2020</h2><ul><li><b>Core Claim:</b> Edge-local inference reduces decision delay in unstable networks.</li><li><b>Methodology:</b> Simulation</li><li><b>Assumptions:</b> Stable clock sync, bounded packet loss</li><li><b>Limitations:</b> Stops at synthetic traffic; no real deployment validation.</li><li><b>Key Concepts:</b> edge inference, sync overhead</li><li><b>Cites:</b> Aris2018</li><li><b>Contradicts:</b> Jones2021</li></ul><h2>Cross-Paper Signals</h2><ul><li><b>Shared Assumptions:</b> Stable synchronization, scalable local compute</li><li><b>Recurring Concepts:</b> latency, robustness, coordination</li><li><b>Methodology Distribution:</b> Simulation 6, Experiment 3, Survey 2, Case Study 1</li></ul>"
  },
  "graph": {
    "instanceName": "Field-Landscape",
    "direction": "RADIAL",
    "mode": "replace",
    "root": {
      "entity": "Field: [Topic Name]",
      "children": [
        {
          "entity": "Hub: Stable Synchronization",
          "children": [
            { "entity": "Paper:Smith2020" },
            { "entity": "Paper:Jones2021" }
          ]
        },
        {
          "entity": "Hub: Local Compute Sufficiency",
          "children": [
            { "entity": "Paper:Lee2022" }
          ]
        }
      ]
    },
    "edges": [
      { "from": "Paper:Smith2020", "to": "Paper:Jones2021", "label": "contradicts" },
      { "from": "Paper:Lee2022", "to": "Hub: Local Compute Sufficiency", "label": "shares_assumption" }
    ]
  }
}
```

## 6. Verification
After creating the outputs, the agent must:
1. Call `readDocument` on `Corpus-Evidence-Model` to verify every paper appears exactly once.
2. Confirm no `Core Claim` exceeds 200 characters.
3. Flag any paper with `Needs Review` fields.
4. Call `readGraph` on `Field-Landscape` to verify node count and cluster integrity.
5. Flag orphan papers that are not connected to a hub or concept branch.
6. Return a short summary table:

        | Paper | Primary Hub | Most Important Concept | Contradictions |
        | :--- | :--- | :--- | :--- |
        | Smith2020 | Stable Synchronization | Edge Inference | Jones2021 |
