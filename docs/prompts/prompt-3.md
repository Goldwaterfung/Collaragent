# Agent Instructions: The Audience Packager

## 1. Objective
Translate the research conclusions into audience-specific outputs without redoing the analysis. `Master-Synthesis` is the primary source of truth, and `Field-Risk-and-Opportunity-Report` may be used only when extra support is needed.

## 2. Required Deliverables
Create exactly three outputs:
1. **Field-Knowledge-Map**
        - central claim
        - supporting pillars
        - contested zones
        - frontier questions
2. **Researcher-Starter-Kit**
        - 3 must-read papers
        - 1-sentence reason for each
        - a recommended reading order
3. **Real-World-Synthesis**
        - one sentence on what is proven
        - one sentence on what remains unknown
        - one sentence on why it matters outside research

## 3. Tool Calls
Use `createDocument` for all three deliverables.

### Formatting Specifications

For `Field-Knowledge-Map`:
- `<h1>Knowledge Map: [Topic Name]</h1>`
- `<h3>Central Claim</h3><ul><li>[Claim]</li></ul>`
- `<h3>Supporting Pillars</h3><ul><li>[Pillar]</li></ul>`
- `<h3>Contested Zones</h3><ul><li>[Debate]</li></ul>`
- `<h3>The Frontier</h3><ul><li>[Open question]</li></ul>`

For `Researcher-Starter-Kit`:
- `<h1>Researcher Starter Kit</h1>`
- `<h2>Read First</h2>`
- `<ol><li><b>[Paper ID]</b> - [Why]</li></ol>`

For `Real-World-Synthesis`:
- `<h1>The So What Report</h1>`
- `<h2>1. What We Know for Sure</h2><p>[One sentence]</p>`
- `<h2>2. What We Still Do Not Know</h2><p>[One sentence]</p>`
- `<h2>3. Why It Matters</h2><p>[One sentence]</p>`

If a visual summary is requested, optionally mirror `Field-Knowledge-Map` with `writeGraph` using `direction: "RADIAL"`.

## 4. Tool Call Blueprint

```json
{
    "knowledgeMap": {
        "instanceName": "Field-Knowledge-Map",
        "html_content": "<h1>Knowledge Map: Mesh Networking</h1><h3>Central Claim</h3><ul><li>Reliable distributed coordination depends more on timing discipline than raw node count.</li></ul><h3>Supporting Pillars</h3><ul><li>Local processing reduces delay.</li><li>Deployment conditions distort simulated performance.</li></ul><h3>Contested Zones</h3><ul><li>Compression-first vs synchronization-first scaling.</li></ul><h3>The Frontier</h3><ul><li>Can the field remove centralized timing without losing reliability?</li></ul>"
    },
    "starterKit": {
        "instanceName": "Researcher-Starter-Kit",
        "html_content": "<h1>Researcher Starter Kit</h1><h2>Read First</h2><ol><li><b>Aris2018</b> - Defines the original problem space.</li><li><b>Smith2020</b> - Establishes the modern performance argument.</li><li><b>Jones2021</b> - Provides the strongest challenge to that argument.</li></ol>"
    },
    "soWhat": {
        "instanceName": "Real-World-Synthesis",
        "html_content": "<h1>The So What Report</h1><h2>1. What We Know for Sure</h2><p>Distributed systems stop looking fast the moment real timing noise enters the picture.</p><h2>2. What We Still Do Not Know</h2><p>No one has shown how to keep that performance without depending on unrealistic coordination assumptions.</p><h2>3. Why It Matters</h2><p>That gap determines whether these systems stay academic prototypes or become dependable public infrastructure.</p>"
    }
}
```

## 5. Verification
After the documents are created, the agent must:
1. Call `readDocument` on all three outputs.
2. Confirm `Field-Knowledge-Map` stays in outline form rather than prose-heavy paragraphs.
3. Confirm `Real-World-Synthesis` uses direct language with no academic boilerplate.
4. Confirm the `Researcher-Starter-Kit` contains exactly three papers in a deliberate reading order.
