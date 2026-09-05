---
name: workspace-document-presentation
description: Principles, heuristics, and reusable HTML patterns for authoring high-density, human-readable workspace documents. Governs the extraction of multi-attribute datasets into structured 2D tables, bullet lead-in mechanics, thematic narrative cohesion, and closing synthesis matrices. Use when drafting, reviewing, or refactoring workspace documents.
---

# Workspace Document Presentation Specialist

**Scope:** How to present information so workspace documents are both **dense with detail** and **immediately human-readable** — separating tabular density from narrative reasoning, eliminating walls of text, and applying publication-grade layout patterns.

**The Governing Principle:** _Density belongs in tables. Narrative belongs in prose. High-dimensional data must never live trapped inside long paragraphs._

---

## 1. When to Use This Skill

- Authoring a new workspace document via `createDocument`
- Refactoring, updating, or reviewing existing workspace documents via `editDocument`
- Converting complex research notes, competitive benchmarks, architecture trade-offs, or system specifications into readable documents
- Preparing synthesis matrices, executive summaries, or technical reports

---

## 2. Dimensional Classification (First Decision)

Before authoring any block, classify the information shape. The number of dimensions dictates the correct HTML format:

| Content Shape                        | Dimensions                 | Format          | HTML Implementation                 | Example                                    |
| :----------------------------------- | :------------------------- | :-------------- | :---------------------------------- | :----------------------------------------- |
| **Entities compared on attributes**  | 2+ (items × attributes)    | Table           | `<table><thead><tr><th>...`         | Competitive matrix, feature audit          |
| **Events over time**                 | 2 (when × what)            | Timeline Table  | `<table>` (Date, Event, Impact)     | Changelog, release milestones, history     |
| **Metrics or scores**                | 2 (metric × value/target)  | Metrics Table   | `<table>` (Metric, Value, Context)  | Benchmark results, KPI dashboard           |
| **Options with consequences**        | 2 (choice × trade-off)     | Trade-off Table | `<table>` (Option, Gain, Cost, Fit) | Architecture decisions, pricing tiers      |
| **Parallel concepts or criteria**    | 1 (unordered inventory)    | Bullets         | `<ul><li><b>Lead-in:</b> text</li>` | System principles, functional requirements |
| **Ordered procedure**                | 1 (chronological/priority) | Numbered list   | `<ol><li><b>Step:</b> action</li>`  | Migration sequence, runbook steps          |
| **Reasoning, thesis, argumentation** | Narrative flow             | Prose           | `<p>` (Thematic Unity)              | Conceptual analysis, synthesis, proofs     |

---

## 3. Core Presentation Directives

### Rule 1: Two Dimensions Belong in Tables

Any comparison, timeline, score card, or trade-off evaluation must be extracted into a `<table>`. Do not chain comparisons in prose using "whereas", "while", or "versus" — every "versus" is a table row asking to exist.

### Rule 2: The Thematic Unity Principle for Prose

Do not artificially truncate narrative into arbitrary sentence quotas. Instead, adhere to **Thematic Unity**:

- Each `<p>` must center around **one core premise or argument**.
- When the premise shifts from explanation to enumeration of attributes, benchmarks, or options, **transition to a table**.
- Preserve scholarly, technical, and mathematical depth in prose where nuance and connective reasoning are essential.

### Rule 3: Visual Indexing on Every Bullet

Never emit bare, unlabeled bullets (`<li>Item 1</li>`). Start every bullet item with a **2–5 word bold label** followed by an explanation:

```html
<ul>
  <li>
    <b>Crash Consistency:</b> Atomic file swaps ensure snapshot integrity during abrupt process
    termination.
  </li>
  <li>
    <b>Off-Thread Compute:</b> Graph clustering algorithms run in background workers to prevent
    main-thread jank.
  </li>
</ul>
```

### Rule 4: Table Anatomy & Scannability

Every table in a workspace document must satisfy three structural requirements:

1. **Labeled Header Row**: Always include `<thead><tr><th>Column</th>...</tr></thead>`.
2. **Bold Row Keys**: The first cell of every data row must be bolded (`<td><b>Row Key</b></td>`) to anchor visual scanning.
3. **Short Cells; Context Below**: Keep individual table cells compact. Place caveats, edge cases, and methodology notes in an italic paragraph directly below the table:
   `<p><i>Note: Benchmarks measured on macOS 14.5 Apple M3 Max with 10k synthetic document nodes.</i></p>`

### Rule 5: Closing Synthesis Matrix

Every major report or analytical document must conclude with a **Summary / Synthesis Matrix** summarizing the core takeaways, trade-offs, and verdicts into 3–6 scannable rows.

---

## 4. Pattern Cookbook: Six Reusable Table Shapes

In CollarAgent workspace documents, tables are represented using standard semantic HTML elements supported by the Lexical engine.

### Pattern 1: Comparison Matrix

Use when contrasting 2 or more entities across shared criteria.

```html
<table>
  <thead>
    <tr>
      <th>Candidate</th>
      <th>Throughput</th>
      <th>Memory Overhead</th>
      <th>Concurrency Model</th>
      <th>Assessment</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>SQLite WAL</b></td>
      <td>~12k ops/s</td>
      <td>Low (~15MB)</td>
      <td>Multi-reader, single-writer</td>
      <td>Optimal for metadata & indexing</td>
    </tr>
    <tr>
      <td><b>Sharded MsgPack</b></td>
      <td>~45k ops/s</td>
      <td>Medium (~40MB)</td>
      <td>Process-isolated shards</td>
      <td>Recommended for content snapshots</td>
    </tr>
  </tbody>
</table>
```

### Pattern 2: Timeline Ledger

Use when chronology, sequence milestones, or historical changes matter.

```html
<table>
  <thead>
    <tr>
      <th>Phase / Date</th>
      <th>Milestone</th>
      <th>Strategic Significance</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Phase 1 (Q1)</b></td>
      <td>Storage V3 Migration</td>
      <td>Enables content-addressed snapshots and zero-copy loads</td>
      <td>Completed</td>
    </tr>
    <tr>
      <td><b>Phase 2 (Q2)</b></td>
      <td>WebSocket Sync Engine</td>
      <td>Coordinates cross-process canvas and editor transactions</td>
      <td>In Progress</td>
    </tr>
  </tbody>
</table>
```

### Pattern 3: Rating & Evaluation Card

Use when synthesizing multi-attribute scoring or qualitative audits.

```html
<table>
  <thead>
    <tr>
      <th>Dimension</th>
      <th>Score (1–5)</th>
      <th>Observed Strength</th>
      <th>Key Limitation</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Type Safety</b></td>
      <td>5 / 5</td>
      <td>Strict nominal branding for canvas & block identifiers</td>
      <td>Requires explicit branded conversions</td>
    </tr>
    <tr>
      <td><b>Tool Output Eviction</b></td>
      <td>4 / 5</td>
      <td>Automatic offloading of payloads >20k tokens</td>
      <td>Requires secondary read step for evicted blobs</td>
    </tr>
  </tbody>
</table>
```

### Pattern 4: Metrics & Performance Dashboard

Use for performance claims, SLAs, benchmarks, or resource budgets.

```html
<table>
  <thead>
    <tr>
      <th>Metric</th>
      <th>Baseline</th>
      <th>Target (SLA)</th>
      <th>Observed</th>
      <th>Verdict</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Initial Cold Boot</b></td>
      <td>1,800ms</td>
      <td>&lt;1,000ms</td>
      <td>720ms</td>
      <td>Exceeds Target</td>
    </tr>
    <tr>
      <td><b>Editor Keystroke Latency</b></td>
      <td>28ms</td>
      <td>&lt;16ms</td>
      <td>11ms</td>
      <td>Optimal (60fps)</td>
    </tr>
  </tbody>
</table>
```

### Pattern 5: Tier Map & Taxonomy

Use when classifying diverse entities into distinct capability or responsibility tiers.

```html
<table>
  <thead>
    <tr>
      <th>Tier</th>
      <th>Subsystems / Components</th>
      <th>Primary Responsibility</th>
      <th>Fault Domain</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Core Platform</b></td>
      <td>Electron Main, PersistenceManager</td>
      <td>Process lifecycle, OS keychain, file locks</td>
      <td>Process crash</td>
    </tr>
    <tr>
      <td><b>Workspace Engine</b></td>
      <td>Lexical Editor, Canvas Worker</td>
      <td>Document rendering, graph layout, local edits</td>
      <td>Isolated tab reload</td>
    </tr>
  </tbody>
</table>
```

### Pattern 6: Trade-Off Matrix

Use when evaluating alternative architectural, operational, or design choices.

```html
<table>
  <thead>
    <tr>
      <th>Strategy</th>
      <th>Core Advantage</th>
      <th>Trade-off / Cost</th>
      <th>When to Choose</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>Inlined Prompts</b></td>
      <td>Zero tool-call turn overhead</td>
      <td>Linear context inflation on every turn</td>
      <td>Fixed, universal invariants (&lt;80 tokens)</td>
    </tr>
    <tr>
      <td><b>Progressive Disclosure</b></td>
      <td>Zero baseline context cost</td>
      <td>Requires one on-demand tool turn to read</td>
      <td>Comprehensive domain guides & specialized skills</td>
    </tr>
  </tbody>
</table>
```

---

## 5. Worked Example: Before & After

### Anti-Pattern: Unstructured Data in Prose

> "The sync engine handles canvas updates in 12ms and editor patches in 6ms under WebSocket transport. When falling back to HTTP polling, canvas latency degrades to 140ms and editor latency to 95ms. HTTP polling consumes 4x more CPU cycles due to connection re-negotiation, so WebSocket is strongly preferred for interactive editing sessions while HTTP polling serves as a failover."

### Refactored: Focused Narrative + Scannable Comparison Matrix

```html
<p>
  The workspace communication layer evaluates WebSocket and HTTP polling transports. WebSocket
  maintains persistent bidirectional streaming, minimizing per-frame serialization overhead during
  rapid cursor movement and layout clustering.
</p>
<table>
  <thead>
    <tr>
      <th>Transport</th>
      <th>Canvas Latency</th>
      <th>Editor Latency</th>
      <th>CPU Load</th>
      <th>Role</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>WebSocket (Primary)</b></td>
      <td>12ms</td>
      <td>6ms</td>
      <td>Baseline (1x)</td>
      <td>Real-time interactive sync</td>
    </tr>
    <tr>
      <td><b>HTTP Polling (Fallback)</b></td>
      <td>140ms</td>
      <td>95ms</td>
      <td>Elevated (4x)</td>
      <td>Degraded network failover</td>
    </tr>
  </tbody>
</table>
<p>
  <i
    >Recommendation: Reserve HTTP polling strictly as a read-only failover path when WebSocket
    handshakes encounter proxy disconnection.</i
  >
</p>
```

---

## 6. Anti-Pattern Catalog & Fixes

| Anti-Pattern                      | Diagnostic Sign                                                      | Remediation                                                                     |
| :-------------------------------- | :------------------------------------------------------------------- | :------------------------------------------------------------------------------ |
| **Wall-of-Text Bullets**          | Bullets spanning 4+ lines containing nested facts and implications   | Split by idea, or convert to a 2D table                                         |
| **Buried Numbers**                | Key metrics, latencies, or dollar amounts hidden in middle sentences | Extract into a Metrics Dashboard table with numbers leading the cell            |
| **Headerless Table**              | `<table>` without `<thead>` or `<th>` elements                       | Add a descriptive `<thead><tr><th>...` header row                               |
| **Centered Body Text**            | `<p style="text-align: center">` used on explanatory prose           | Remove inline styling; reserve centering exclusively for titles/cover elements  |
| **Prose Impersonating Structure** | Sentences chained with "whereas", "compared to", "on the other hand" | Split into comparison table rows with explicit attribute columns                |
| **Unindexed Bullet Stacks**       | Lists using generic markers without visual signposts                 | Prefix each `<li>` with a bolded 2–4 word lead-in (`<li><b>Name:</b> ...</li>`) |

---

## 7. Pre-Publish Checklist

Before concluding document creation or editing with `createDocument` or `editDocument`, verify:

1. [ ] **Tabular Completeness**: Are all 2+ dimensional datasets (comparisons, timelines, metrics, options) formatted as tables?
2. [ ] **Table Polish**: Does every table have a clear `<thead>`, `<th>` headers, and bold row keys (`<td><b>...</b></td>`)?
3. [ ] **Bullet Indexing**: Does every bullet item have a concise bold lead-in phrase?
4. [ ] **Prose Cohesion**: Is continuous text organized around unified thematic concepts rather than fragmented sentences?
5. [ ] **Synthesis Closure**: Does the document conclude with a summary matrix or actionable verdict table?
6. [ ] **HTML Syntax Compliance**: Are all blocks valid HTML compatible with CollarAgent's Lexical parser (no unescaped raw Markdown table pipes inside HTML blocks)?
