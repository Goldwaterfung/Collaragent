---
name: research-stage-4-experimental-methodology
description: Multi-agent experimental methodology and formal modeling skill. Designs experimental protocols, participant sampling power analyses (G*Power), stimulus apparatus controls, and KaTeX mathematical models in scholarly document format using subagents.
---

# Research Stage 4: Experimental Methodology & Formal Modeling

Stage 4 multi-agent orchestration skill for designing rigorous, reproducible experimental paradigms, calculating statistical sample size power, specifying apparatus telemetry, and embedding KaTeX mathematical models into the CollarAgent Lexical workspace.

---

## When to Use This Skill

- Operationalizing directional hypotheses (Stage 3) into an actionable, reproducible empirical experimental protocol.
- Formulating mathematical equations (psychometrics, Signal Detection Theory, reaction time models, or cognitive efficiency) using KaTeX notation.
- Specifying participant inclusion/exclusion criteria, statistical power analyses ($G*\text{Power}$), and ethical review boundaries.
- Documenting apparatus hardware specifications, timing error budgets, and trial sequence counterbalancing (e.g. Latin Square).

---

## Integrated Foundation Skills

This stage integrates and operationalizes principles from:

- **`apa-research-execution-specialist`**:
  - Enforces APA 7th Edition Method section hierarchy:
    1. **Participants & Power Analysis** (inclusion, exclusion, power parameters)
    2. **Apparatus & Materials** (hardware specs, sampling rates, stimulus controls)
    3. **Experimental Design** (within/between factors, Latin Square counterbalancing)
    4. **Procedure & Trial Timeline** (step-by-step participant journey)
  - Enforces formal statistical reporting standards (effect sizes, alpha thresholds, power bounds).
- **`focused-execution-specialist`**:
  - Maintains strict protocol fidelity and rejects ambiguous apparatus timing or uncalibrated measurements.

---

## Multi-Agent Subagent Worker Topology

The Stage 4 Orchestrator coordinates four specialized subagent workers:

```
                  [Stage 4 Methodology Orchestrator]
                                  │
    ┌─────────────────────────────┼─────────────────────────────┐
    ▼                             ▼                             ▼
[Subagent 1: Protocol Designer] [Subagent 2: Math Modeler]  [Subagent 3: Apparatus Engineer]
(Power Analysis & Design)      (KaTeX Equations & Formal)   (Telemetry & Latency Budgets)
                                                                    │
                                                                    ▼
                                                       [Subagent 4: Document Stager]
                                                       (createDocument & editDocument)
```

### Worker Roles & Delegation Contracts

| Subagent Worker Role               | Responsibility                                                                                                                     | Input Contract                                      | Expected Deliverable                                                                |
| :--------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------- | :---------------------------------------------------------------------------------- |
| **`protocol-designer`**            | Conducts statistical power analysis ($G*\text{Power}$), defines participant recruitment criteria, and structures factorial design. | Formal hypotheses and variable matrix from Stage 3. | Statistical power parameters ($\alpha, \beta, f$) and experimental design taxonomy. |
| **`mathematical-modeler`**         | Formulates exact mathematical models, equations, and psychometric functions in KaTeX markup.                                       | Theoretical constructs and operational variables.   | Valid KaTeX LaTeX equation strings and parameter definitions.                       |
| **`apparatus-telemetry-engineer`** | Details hardware/software stack, sensor sampling rates, latency error budgets, and trial sequence counterbalancing.                | Experimental factors and measurement metrics.       | Apparatus specification table and timing sequence diagram.                          |
| **`methodology-document-stager`**  | Assembles complete protocol and persists `Methodology_Protocol` via `createDocument` / `editDocument`.                             | Synthesized sections from Workers 1, 2, and 3.      | Persisted Lexical document in workspace ready for human gate signoff.               |

---

## Step-by-Step Multi-Agent Execution Protocol

### Step 1: Statistical Power Analysis & Design Architecture (`protocol-designer`)

1. Determine design architecture: Within-Subjects, Between-Subjects, or Mixed Factorial.
2. Execute formal $G*\text{Power}$ power analysis:
   - State significance level ($\alpha = .05$).
   - State statistical power ($1 - \beta \ge .80$, recommended $.95$ for high rigor).
   - Specify expected effect size based on Stage 2 literature baseline (e.g. Cohen's $f = 0.25$ or Cohen's $d = 0.50$).
   - Calculate exact minimum sample size $N$ and round up for counterbalancing balance (e.g. multiples of Latin Square size).

### Step 2: Mathematical Formalization in KaTeX (`mathematical-modeler`)

Formulate all theoretical models and psychometric equations:

1. **Signal Detection Theory ($SDT$)**:
   $$\Phi^{-1}(\text{Hit}) - \Phi^{-1}(\text{False Alarm}) = d'$$
   $$c = -\frac{1}{2}\left[\Phi^{-1}(\text{Hit}) + \Phi^{-1}(\text{False Alarm})\right]$$
2. **Psychometric Detection Curve (Weibull / Logistic)**:
   $$\Psi(x) = \gamma + (1 - \gamma - \lambda)\left(1 - e^{-(x / \alpha)^\beta}\right)$$
3. **Cognitive Efficiency ($E$)**:
   $$E = \frac{\bar{Z}_{\text{Performance}} - \bar{Z}_{\text{Effort}}}{\sqrt{2}}$$

### Step 3: Apparatus Telemetry & Error Budgets (`apparatus-telemetry-engineer`)

1. Document physical hardware (e.g. headphone type, display refresh rate, tracking camera frame rate).
2. Specify software pipeline and buffer sizes (e.g. audio buffer: 128 samples @ 48 kHz $\rightarrow$ 2.67 ms chunk duration).
3. Compute **End-to-End Latency Budget**: Sum individual delay stages (Sensor $\rightarrow$ Transmission $\rightarrow$ Computation $\rightarrow$ Output DAC) and establish maximum timing jitter ($\sigma < 1.0\text{ ms}$).

### Step 4: Step-by-Step Procedure & Counterbalancing

1. Detail participant onboarding, consent, audiometric/visual screening, and calibration.
2. Outline trial sequence: Fixation $\rightarrow$ Stimulus Presentation $\rightarrow$ Response Window $\rightarrow$ Inter-Trial Interval (ITI).
3. Specify counterbalancing (e.g. Balanced Latin Square) to eliminate order, fatigue, and learning carryover effects.

### Step 5: Document Compilation (`methodology-document-stager`)

Invoke `createDocument` to compile `Methodology_Protocol` in the workspace using clean HTML tags and KaTeX math blocks.

### Step 6: Human Gate Verification

Present the methodology protocol to the human researcher for feasibility review and IRB alignment before proceeding to Stage 5 (Scholarly Synthesis).

---

## Workspace Tool Call Signatures & Examples

### 1. Create Methodology Protocol Document (`createDocument`)

```json
{
  "instanceName": "Methodology_Protocol",
  "projectName": "Research-Workspace",
  "html_content": "<h1>Experimental Methodology &amp; Mathematical Modeling</h1><h2>1. Participants &amp; Statistical Power Analysis</h2><p>An a priori statistical power analysis was conducted using G*Power 3.1 for a repeated-measures within-subjects ANOVA (alpha = .05, power = .95, medium effect size f = 0.25). The minimum required sample size is N = 36. To counterbalance a 4-condition Latin Square and account for potential 10% attrition, <b>N = 40</b> participants will be recruited.</p><h2>2. Mathematical Modeling of Psychometric Detection</h2><p>The probability of detecting latency disparity is modeled via a two-parameter Weibull psychometric function:</p><p>$$\\Psi(\\Delta t) = \\gamma + (1 - \\gamma - \\lambda) \\left( 1 - \\exp\\left( -\\left( \\frac{\\Delta t}{\\alpha} \\right)^\\beta \\right) \\right)$$</p><p>where &gamma; = 0.50 denotes chance performance in a 2AFC task, &lambda; represents the stimulus-independent lapse rate, &alpha; is the 79.4% detection threshold (JND), and &beta; represents psychometric slope.</p><h2>3. Apparatus &amp; Hardware Telemetry</h2><table><tr><th>Component</th><th>Specification</th><th>Sampling Rate / Latency</th><th>Error Budget (&sigma;)</th></tr><tr><td>Motion Tracker</td><td>OptiTrack Prime 13W (6-DoF)</td><td>240 Hz (&Delta;t = 4.16 ms)</td><td>&plusmn;0.15 mm / &plusmn;0.05&deg;</td></tr><tr><td>Audio Engine</td><td>Binaural BRIR Convolution (128 spl)</td><td>48 kHz (&Delta;t = 2.67 ms)</td><td>&plusmn;0.20 ms jitter</td></tr><tr><td>Visual Display</td><td>Varjo Aero VR HMD</td><td>90 Hz (&Delta;t = 11.1 ms)</td><td>Zero tearing</td></tr></table>"
}
```

### 2. Update Protocol with Detailed Procedure Steps (`editDocument`)

```json
{
  "instanceName": "Methodology_Protocol",
  "projectName": "Research-Workspace",
  "operations": [
    {
      "action": "insert",
      "blockId": "b_apparatus_table",
      "anchor": "after",
      "newHtml": "<h2>4. Experimental Procedure &amp; Trial Structure</h2><p>Each trial sequence follows a strict four-phase timeline:</p><ol><li><b>Pre-Trial Calibration (500 ms):</b> Participant aligns head yaw within &plusmn;1.5&deg; of the central fixation anchor.</li><li><b>Active Rotation Stimulus (1,200 ms):</b> Visual cue instructs participant to rotate head at target velocity (20&deg;/s vs. 60&deg;/s) guided by audio-visual pacing metronome.</li><li><b>2AFC Response Interval (Self-Paced):</b> Participant indicates whether auditory source tracked rigidly or exhibited detectable lag.</li><li><b>Inter-Trial Interval (1,000 ms):</b> Auditory and visual buffers flush and reset.</li></ol>"
    }
  ],
  "explanation": "Add 4-phase trial timeline to experimental procedure"
}
```

### 3. Read Methodology Protocol State (`readDocument`)

```json
{
  "instanceName": "Methodology_Protocol",
  "projectName": "Research-Workspace"
}
```

---

## Error Handling & Invariant Rules

1. **Power Analysis Invariant**:
   - Every experimental methodology document MUST explicitly specify $\alpha$, $1-\beta$, expected effect size, and target $N$. Protocols lacking statistical power justification will be rejected at the gate.
2. **KaTeX Syntax Invariant**:
   - Math expressions must use valid LaTeX syntax (`\frac{}{}`, `\sum`, `\Delta`, `\exp`). Escape backslashes properly in JSON payloads (`\\`).
3. **Table Rectangularity Invariant**:
   - Ensure the Apparatus & Telemetry table has an identical number of `<th>` / `<td>` elements in each row.
4. **Apparatus Timing Precision**:
   - Hardware specifications must include sampling frequency, buffer size, and expected latency jitter. Ambient uncalibrated systems are strictly prohibited.

---

## Stage 4 Gate Exit Checklist

Before declaring Stage 4 complete and handing off to Stage 5 (`research-stage-5-scholarly-synthesis`):

- [ ] Statistical power analysis ($G*\text{Power}$) explicitly computes required $N$.
- [ ] Experimental design specifies factor levels and counterbalancing schema (e.g. Latin Square).
- [ ] Formal mathematical equations are fully defined and render validly in KaTeX.
- [ ] Apparatus hardware specifications, sampling rates, and error budgets are documented in a structured table.
- [ ] Step-by-step procedural timeline and calibration criteria are established.
- [ ] `Methodology_Protocol` document is persisted in the workspace.
- [ ] The human researcher has verified and approved the methodology design.
