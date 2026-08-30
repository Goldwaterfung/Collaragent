<div align="center">

<img src="build/icon.png" width="64" height="64" alt="CollarAgent Logo" />

# CollarAgent: The Local-First Visual Research & Academic Writing Studio

<p align="center">
  <b>Transform conversational AI brainstorming into living concept maps, structured academic papers, and essays.<br>Stop losing context in disconnected chat tabs—collaborate visually, verify every edit, and write with total peace of mind.</b>
</p>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Local-First](https://img.shields.io/badge/Storage-Local--First%20(%2Ecagent)-success.svg)](#local-first-data-privacy--portability)
[![Multi-Provider](https://img.shields.io/badge/LLM-OpenAI%20%7C%20Anthropic%20%7C%20Gemini%20%7C%20Ollama-blueviolet.svg)](#key-features)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg)](#project-setup)
[![Design Catalog](https://img.shields.io/badge/Architecture-C4%20Catalog%20%26%20ADRs-orange.svg)](docs/design-catalog/README.md)

---

<p align="center">
  <a href="#overview">Overview</a> •
  <a href="#why-collaragent">Why CollarAgent</a> •
  <a href="#the-unified-3-pane-studio">Unified Studio</a> •
  <a href="#academic-use-cases">Academic Use Cases</a> •
  <a href="#interactive-workflows">Interactive Workflows</a> •
  <a href="#what-your-ai-agent-can-do">Agent Capabilities</a> •
  <a href="#key-features">Key Features</a> •
  <a href="#project-setup">Quick Start</a> •
  <a href="#architecture--design">Architecture</a>
</p>

</div>

---

## Overview

You opened your editor to write a breakthrough paper, synthesize research, or craft a syllabus—not to drown in dozens of disconnected browser tabs, copy-paste across diagram tools, and worry if an AI prompt will overwrite your hard work. **Your tools should empower your deep thinking, not fragment it.**

**CollarAgent** is a local-first desktop IDE that pairs an autonomous AI agent with an **infinite concept canvas** and a **scholarly rich-text document engine**. Instead of treating research as isolated text prompts, CollarAgent unifies your thought process: brainstorm complex theories with your AI co-pilot, watch it construct living node-link concept maps, organize evidence with automated clustering, and draft publication-ready manuscripts with LaTeX math and native Microsoft Word (`.docx`) export.

---

## Why CollarAgent?

Drafting essays, literature reviews, and research papers requires multi-dimensional thinking. Traditional tools force a painful compromise between visual mapping, structured writing, and AI chat.

| Traditional Research & Writing Workflow | CollarAgent Visual & Agentic Workflow |
| :--- | :--- |
| **Disconnected Context**: Juggling Miro/FigJam for mind maps, Notion/Obsidian for notes, and ChatGPT for drafting. | **Unified 3-Pane Studio**: Canvas, document editor, and AI agent run side-by-side in one synchronized workspace. |
| **Destructive AI Overwrites**: AI assistants silently replace entire drafts or delete structural notes with no review step. | **Safe Staged Proposals**: All AI edits are staged as visual diffs on the canvas and in the document for one-click accept/reject. |
| **Broken Chat Memory on Rollbacks**: Undoing an AI mistake requires manual text reverts while chat context remains polluted. | **Multi-Domain Time Travel**: Captures atomic snapshots across chat history, agent reasoning memory, and workspace files. |
| **Manual Formula & Export Hassles**: Clunky equation formatting and broken copy-pasting into word processors. | **Scholarly Lexical Engine**: Native LaTeX ($\text{KaTeX}$), GFM tables, Prism syntax, and direct export to Word (`.docx`). |
| **Cloud Data Lock-in**: Research drafts, private notes, and proprietary data hosted on third-party cloud servers. | **100% Local-First Ownership**: Self-contained `.cagent` archives stored on your disk with OS keychain encryption. |

---

## The Unified 3-Pane Studio

CollarAgent brings together three synchronized environments inside a flexible, multi-dock desktop workspace:

<table>
  <thead>
    <tr>
      <th align="center" colspan="3"><strong>CollarAgent Studio Environment</strong></th>
    </tr>
    <tr>
      <th align="left" width="33%">🎨 Visual Concept Canvas</th>
      <th align="left" width="33%">📄 Scholarly Document Engine</th>
      <th align="left" width="34%">🤖 AI Research Co-Pilot</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td valign="top">
        <ul>
          <li><b>Infinite Canvas</b> with pan &amp; zoom</li>
          <li><b>4-Cardinal Port Routing</b> (N, E, S, W)</li>
          <li><b>Automated Theme Clustering</b> (Leiden Web Worker)</li>
          <li><b>Embedded Memo Cards</b> (Lexical inside nodes)</li>
          <li><b>Bidirectional Drag-and-Drop</b> with editor</li>
        </ul>
      </td>
      <td valign="top">
        <ul>
          <li><b>LaTeX Mathematical Notation</b> (<a href="https://katex.org/">KaTeX</a>)</li>
          <li><b>GFM Tables</b> &amp; Code Highlighting (Prism)</li>
          <li><b>Inline Annotations</b> &amp; Review Comments</li>
          <li><b>Block Drag Handles</b> for spatial organization</li>
          <li><b>Direct Export</b> to Word (<code>.docx</code>)</li>
        </ul>
      </td>
      <td valign="top">
        <ul>
          <li><b>Staged Proposals</b> with visual diffs</li>
          <li><b>Progressive Disclosure Skills</b> (<a href="https://agentskills.io">Agent Skills</a>)</li>
          <li><b>Multi-Provider LLMs</b> (OpenAI, Claude, Gemini, Ollama)</li>
          <li><b>Subagent Task Delegation</b> (LangGraph core)</li>
          <li><b>Point-in-Time Checkpoint</b> rollbacks</li>
        </ul>
      </td>
    </tr>
  </tbody>
</table>

---

## Academic & Research Use Cases

CollarAgent supports broad academic disciplines and research workflows:

### 🔬 1. Psychology & Social Sciences: Literature Reviews & Theoretical Frameworks
* **Visual Hypothesis Mapping**: Map independent, dependent, and moderating variables across empirical studies on the canvas.
* **Thematic Clustering**: Automatically group qualitative findings and literature themes using Leiden community detection.
* **Structured Synthesis**: Draft literature reviews with structured evidence tables and inline citation notes.

### 📐 2. Mathematics & Quantitative Sciences: Formal Proofs & Theorem Topologies
* **LaTeX Formula Authoring**: Write complex equations and derivations using instant $\text{KaTeX}$ rendering.
* **Theorem Dependency Graphs**: Connect lemmas, definitions, and theorems visually to verify logical consistency.
* **Proof Drafting**: Structure step-by-step mathematical proofs with synchronized explanations.

### 📜 3. Linguistics, Humanities & Language Studies: Semantic Analysis & Essays
* **Semantic & Etymology Graphs**: Map character etymology trees, linguistic roots, and semantic shifts (e.g., Chinese character evolution, historical linguistics).
* **Thematic Essay Outlining**: Structure multi-chapter historical theses, comparative literature essays, and historiographical debates.
* **Multilingual Typography**: Full Unicode support for non-Latin scripts, ancient texts, and phonetics.

### 🎓 4. Educators & Course Designers: Curriculum Mapping & Lesson Plans
* **Curriculum Mind-Maps**: Visually sequence lecture modules, prerequisite knowledge, and learning outcomes.
* **Drag-to-Handout Assembly**: Drag conceptual cards directly from your canvas map into your syllabus document.
* **One-Click Word Export**: Export finished course outlines and student study guides to polished `.docx` files.

---

## Interactive Workflows

Here is what collaborating with CollarAgent looks like during active research:

```text
User    ❯ @Canvas Map out the relationship between Cognitive Load Theory (Sweller) 
          and Dual-Coding Theory (Paivio), connect their working memory channels, 
          and draft an introduction section with a summary table.

Agent   ❯ [CollarAgent Engine]
          ✓ Analyzed literature on Cognitive Load Theory & Dual-Coding Theory
          ✓ Created 4 concept nodes: Visual Channel, Auditory Channel, Germane Load, Extraneous Load
          ✓ Connected directional relationship: Visual Channel ──[dual-coding]──> Long-Term Memory
          ✓ Generated staged canvas proposal (4 nodes, 3 links added)
          ✓ Drafted introduction with comparison table in Document Editor
          
          [Proposal Banner: 4 nodes added to Canvas | 1 block updated in Editor]
          [Accept Changes]  [Reject Changes]
```

```text
User    ❯ @Document Add the mathematical formula for Shannon Entropy in LaTeX and 
          connect it to our Information Theory node on the canvas.

Agent   ❯ [CollarAgent Engine]
          ✓ Inserted LaTeX formula: $$H(X) = -\sum_{i=1}^{n} P(x_i) \log_2 P(x_i)$$
          ✓ Linked Document Block #3 to Canvas Node 'Information-Theory-Root'
          ✓ Checkpoint captured: #chk-204 (Auto-saved before mutation)
          Done. You can rollback to this point at any time.
```

---

## Key Features

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <h3>🎨 Visual Concept Mapping &amp; Clustering</h3>
      <p>Organize arguments, research hypotheses, and literature notes on an infinite canvas. Automatically discover thematic groupings with background Leiden community clustering.</p>
    </td>
    <td width="50%" valign="top">
      <h3>📄 Scholarly Lexical Document Engine</h3>
      <p>Draft publication-grade manuscripts with LaTeX math (<a href="https://katex.org/">KaTeX</a>), GFM tables, Prism syntax highlighting, and native compilation to Microsoft Word (<code>.docx</code>).</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🛡️ Safe, Staged AI Co-Authoring</h3>
      <p>Never worry about AI overwriting your hard work. Every agent suggestion is staged with visual diffs on the canvas and in the document. You inspect, accept, or reject with one click.</p>
    </td>
    <td width="50%" valign="top">
      <h3>⏱️ Multi-Domain Time Travel</h3>
      <p>Explore bold theories freely. Every turn captures an atomic snapshot of your chat history, agent reasoning state, canvas graph, and document files for instant point-in-time rollbacks.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>🔐 100% Local-First Data Privacy</h3>
      <p>Your research, intellectual property, and drafts remain strictly on your local disk in portable <code>.cagent</code> archives. API credentials are encrypted with your OS native keychain.</p>
    </td>
    <td width="50%" valign="top">
      <h3>🧠 Multi-Provider &amp; Subagent Pipeline</h3>
      <p>Connect seamlessly to OpenAI, Anthropic (with prompt caching), Google Gemini, or local Ollama models. Delegate multi-step research to isolated sub-agents with progressive skills.</p>
    </td>
  </tr>
</table>

---

## What Your AI Agent Can Do

Instead of simple conversational replies, your AI co-pilot actively orchestrates your research workspace:

* **Visual Graph Modeling**: Construct concept nodes, connect directional relationships, auto-arrange layouts (Dagre / Radial), and run off-thread Leiden community clustering.
* **Scholarly Document Authoring**: Write and edit sections, insert LaTeX equations, generate comparison tables, format code blocks, and attach inline commentary.
* **Safe Proposal Staging**: Propose additions and refactors as non-destructive staged diffs that require user confirmation.
* **Deep Literature Synthesis**: Spawn sub-agents for multi-step background investigation, search web sources, and synthesize findings.
* **Point-in-Time Checkpointing**: Automatically capture snapshots before major turns and coordinate rollbacks across conversation, agent state, and workspace files.

---

## Project Setup

### Prerequisites

* **[Node.js](https://nodejs.org/)** (v20 or higher recommended)
* **npm**

### Installation

Clone the repository and install project dependencies:

```bash
git clone https://github.com/Goldwaterfung/collaragent.git
cd collaragent
npm install
```

### Development

Launch the desktop application in development mode with hot-reloading:

```bash
npm run dev
```

### Build & Packaging

Package standalone production binaries for your target operating system:

```bash
# For macOS (DMG / Zip)
npm run build:mac

# For Windows (NSIS Installer / Portable)
npm run build:win

# For Linux (AppImage / deb)
npm run build:linux
```

---

## Architecture & Design

CollarAgent is architected for extreme responsiveness, deterministic state transitions, and absolute data safety:

* **Multi-Process Electron Host**: Electron Main Host for runtime orchestration, Chromium Renderer at 60 FPS, and an isolated Node.js `UtilityProcess` storage daemon ([ADR-001](docs/design-catalog/adrs/adr-001-multi-process-electron-utility-daemon.md)).
* **Sharded V3 Storage Engine**: Sub-millisecond incremental writes with atomic MessagePack snapshots (`.cagent` / `.collar`) ([ADR-002](docs/design-catalog/adrs/adr-002-sharded-v3-cagent-storage-engine.md)).
* **Deterministic Inversion Engine**: Mathematical inverse command calculations powering undo/redo and proposal rollbacks ([ADR-005](docs/design-catalog/adrs/adr-005-deterministic-inverse-command-rollback.md)).
* **Progressive Skills Architecture**: Token-efficient dynamic skill loading following the [Agent Skills standard](https://agentskills.io) ([ADR-004](docs/design-catalog/adrs/adr-004-progressive-disclosure-agent-skills.md)).

For full C4 diagrams, EventStorming workflows, and ADR specifications, explore the [Architecture Design Catalog](docs/design-catalog/README.md).

---

## License

This project is licensed under the [MIT License](LICENSE).
