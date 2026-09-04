# Implementation Plan: End-to-End Scientific Research Scenarios Across Domains

Redesign the evaluation scenario suite in CollarAgent to benchmark DeepAgent across **30 standardized, end-to-end scientific research scenarios** spanning 5 distinct academic domains (including Psychology and cross-domain Psychoacoustics). Each domain models the complete scientific research lifecycle: idea brainstorming, literature gap analysis, hypothesis and research question formulation, experimental paradigm design with mathematical modeling, APA 7 document synthesis, and invariant rollback/error recovery.

## User Review Required

> [!IMPORTANT]
> **Domain & Lifecycle Alignment**: We propose a 5x6 matrix (5 domains x 6 research stages = 30 scenarios). This satisfies the "20 to 30 scenarios" benchmark mandate from [positioning-strategy.md](file:///Users/goldenfung/Documents/apply-jobs/docs/positioning/positioning-strategy.md) while giving each domain a coherent end-to-end research arc:
>
> 1. **Cognitive Psychology** (Dual-Task Attention & Cognitive Load Theory)
> 2. **Psychoacoustics & Auditory Perception** (Spatial Audio Localization, ITD/ILD, HRTF, Perceptual Latencies)
> 3. **HCI & Mixed-Initiative Agent Systems** (Shared Mental Models, Human Agency, Staged Diff Invariants)
> 4. **Cognitive Neuroscience / Neuroergonomics** (EEG Event-Related Potentials, P300 Workload Biomarkers)
> 5. **Clinical AI / Medical Decision Support** (Diagnostic Dialogue Grounding, Hallucination Mitigation)

> [!NOTE]
> **Dual Orthogonal Taxonomy**:
>
> - **Domain Dimension** (accessible via tags): `psychology`, `psychoacoustics`, `hci`, `neuroscience`, `clinical_ai`.
> - **Invariant Tier Dimension** (compatible with existing [`ScenarioTier`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/types.ts#L11-L12)):
>   - Stage 1 (Brainstorming & Knowledge Graph) $\rightarrow$ `tier2_graph`
>   - Stage 2 (Subagent Literature Research & Sourcing) $\rightarrow$ `tier5_subagents`
>   - Stage 3 (Hypothesis & Research Question Formulation) $\rightarrow$ `tier1_doc`
>   - Stage 4 (Experimental Methodology & KaTeX Modeling) $\rightarrow$ `tier1_doc`
>   - Stage 5 (Error Recovery & Protocol Boundary Testing) $\rightarrow$ `tier3_errors`
>   - Stage 6 (Ablation, Refinement & Mathematical Rollback) $\rightarrow$ `tier4_rollback`

---

## The 30 End-to-End Scientific Research Scenarios

### Domain 1: Cognitive Psychology (Dual-Task Interference & Cognitive Load)

_Theme: Investigating working memory bottlenecks when using multi-pane spatial concept maps vs. textual documents._

- **`SCN-PSY-01` (Stage 1: Brainstorming / Graph)**: Use `writeMindMap` to construct Sweller's Cognitive Load Theory architecture (Intrinsic, Extraneous, Germane load) and map working memory constraints.
- **`SCN-PSY-02` (Stage 2: Literature Search / Subagents)**: Delegate to researcher subagent to retrieve empirical literature on Baddeley's multicomponent working memory model and visual-spatial sketchpad capacity limits.
- **`SCN-PSY-03` (Stage 3: Hypothesis & RQ / Doc)**: Draft formal Research Questions ($RQ_1, RQ_2$) and directional hypotheses ($H_1: \mu_{\text{split}} > \mu_{\text{integrated}}$) in Lexical document format.
- **`SCN-PSY-04` (Stage 4: Experimental Methodology / Doc)**: Formalize dual-task N-back interference paradigm, sample sizing ($G*\text{Power}$ calculations), and KaTeX response time variance formulas.
- **`SCN-PSY-05` (Stage 5: Schema Error Recovery / Errors)**: Inject an invalid tool payload with corrupted block types during section drafting; agent must detect error and self-correct without crashing.
- **`SCN-PSY-06` (Stage 6: Hypothesis Ablation / Rollback)**: Propose insertion of an ungrounded confounding variable into the experimental model, simulate user rejection, and verify 100% byte parity rollback via [`InverseCommandEngine`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/runtime/InverseCommandEngine.ts).

### Domain 2: Psychoacoustics & Auditory Perception (Cross-Domain: Audio DSP + Psychology)

_Theme: Perceptual latency and spatial localization accuracy in binaural Ambisonics rendering._

- **`SCN-ACO-01` (Stage 1: Brainstorming / Graph)**: Build an interconnected knowledge graph of spatial auditory cues: Interaural Time Difference (ITD), Interaural Level Difference (ILD), Head-Related Transfer Functions (HRTF), and the Cone of Confusion.
- **`SCN-ACO-02` (Stage 2: Literature Search / Subagents)**: Delegate literature search on dynamic pinna spectral cues and minimum audible angle (MAA) thresholds in 6-DoF virtual reality.
- **`SCN-ACO-03` (Stage 3: Hypothesis & RQ / Doc)**: Formulate hypotheses regarding audiovisual latency desynchronization detection thresholds ($\Delta t_{\text{audio}} < 15\text{ms}$).
- **`SCN-ACO-04` (Stage 4: Methodology & KaTeX / Doc)**: Draft 2-Alternative Forced Choice (2AFC) adaptive staircase protocol with Weber-Fechner law equations in KaTeX ($\Delta S / S = k$).
- **`SCN-ACO-05` (Stage 5: Acoustic Range Error Recovery / Errors)**: Agent encounters an invalid frequency band range argument (e.g. negative Hz); catches domain error and recovers valid audible spectrum range (20 Hz - 20 kHz).
- **`SCN-ACO-06` (Stage 6: Parameter Rollback / Rollback)**: Stage an automated calibration table change, execute inverse rollback, and confirm exact byte-level snapshot parity against pre-test state.

### Domain 3: Human-Computer Interaction (HCI) & Mixed-Initiative AI Co-Work

_Theme: Agency, cognitive friction, and error-resilience in staged human-AI co-authoring systems._

- **`SCN-HCI-01` (Stage 1: Brainstorming / Graph)**: Map Horvitz's Principles of Mixed-Initiative Interaction, Shneiderman's Human-Centered AI matrix, and mixed-initiative state machine transitions.
- **`SCN-HCI-02` (Stage 2: Prior Art / Subagents)**: Multi-agent retrieval of literature on automation bias, human-in-the-loop escalation triggers, and diff-staging mechanics.
- **`SCN-HCI-03` (Stage 3: Hypothesis & RQ / Doc)**: Formulate testable claims: staged diff previews reduce uninspected error adoption rate by $\ge 40\%$ compared to direct mutation.
- **`SCN-HCI-04` (Stage 4: Methodology / Doc)**: Detail a within-subjects Latin square user study protocol measuring Task Completion Time (TCT) and NASA-TLX cognitive workload subscales.
- **`SCN-HCI-05` (Stage 5: State Collision Recovery / Errors)**: Simulate concurrent editing conflict where document instance was updated by human; agent re-reads fresh state and applies non-conflicting patch.
- **`SCN-HCI-06` (Stage 6: Invariant Rollback / Rollback)**: Test complex multi-block document mutation followed by inverse command execution, verifying complete AST restoration.

### Domain 4: Cognitive Neuroscience & Neuroergonomics

_Theme: Prefrontal cortex mental workload and Event-Related Potential (P300) biomarkers during high-stakes decision making._

- **`SCN-NEU-01` (Stage 1: Brainstorming / Graph)**: Construct systems graph linking cognitive fatigue, autonomic nervous system indicators (HRV), and EEG frequency band powers ($\theta, \alpha, \beta$).
- **`SCN-NEU-02` (Stage 2: Literature Search / Subagents)**: Query neuroergonomics literature on P300 amplitude attenuation under visual clutter and task saturation.
- **`SCN-NEU-03` (Stage 3: Hypothesis & RQ / Doc)**: Author formal hypotheses connecting visual interface density to P300 peak latency delay ($\tau_{\text{latency}}$).
- **`SCN-NEU-04` (Stage 4: Methodology & KaTeX / Doc)**: Specify 64-channel 10-20 EEG electrode placement montage, bandpass filter parameters (0.1–30 Hz), and baseline correction formulas in KaTeX.
- **`SCN-NEU-05` (Stage 5: Montage Error Recovery / Errors)**: Agent provides duplicate electrode identifier; recovers by detecting AST table error and deduplicating montage.
- **`SCN-NEU-06` (Stage 6: Electrode Config Rollback / Rollback)**: Rollback unwanted electrode impedance threshold adjustments, ensuring zero corruption to surrounding study protocol.

### Domain 5: Clinical AI & High-Reliability Decision Support

_Theme: Diagnostic dialogue grounding, clinical vignette validation, and hallucination containment._

- **`SCN-MED-01` (Stage 1: Brainstorming / Graph)**: Map clinical differential diagnosis decision tree with symptom clusters, risk strata, and diagnostic test sensitivities/specificities.
- **`SCN-MED-02` (Stage 2: Literature Search / Subagents)**: Retrieve clinical NLP benchmarks on hallucination rates in electronic health record (EHR) summarization.
- **`SCN-MED-03` (Stage 3: Hypothesis & RQ / Doc)**: Formulate $RQ$: Does strict Zod schema validation eliminate out-of-vocabulary medical ontology terms in clinical recommendations?
- **`SCN-MED-04` (Stage 4: Methodology / Doc)**: Detail 50-vignette cross-validation protocol using Fleiss' Kappa ($\kappa$) for multi-clinician concordance and diagnostic sensitivity tables.
- **`SCN-MED-05` (Stage 5: Hallucinated Code Recovery / Errors)**: Agent injects an unverified ICD-10 diagnostic code; catches schema validation rejection and autonomously queries verified code list.
- **`SCN-MED-06` (Stage 6: Safety Rollback / Rollback)**: Rollback an unverified medication dosage suggestion from clinical protocol, asserting byte parity with pristine pre-recommendation state.

---

## Proposed Code Changes

### Evaluation Scenario Definitions & Fixtures

#### [NEW] [`evals/scenarios/domains/psychology.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/domains/psychology.ts)

Definitions for scenarios `SCN-PSY-01` through `SCN-PSY-06` with prompts, expected tool calls (`writeMindMap`, `createDocument`, `editDocument`), initial fixtures, and invariant rules.

#### [NEW] [`evals/scenarios/domains/psychoacoustics.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/domains/psychoacoustics.ts)

Definitions for scenarios `SCN-ACO-01` through `SCN-ACO-06` modeling the spatial audio perception research workflow.

#### [NEW] [`evals/scenarios/domains/hci.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/domains/hci.ts)

Definitions for scenarios `SCN-HCI-01` through `SCN-HCI-06` modeling mixed-initiative interaction and staged agent co-work.

#### [NEW] [`evals/scenarios/domains/neuroscience.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/domains/neuroscience.ts)

Definitions for scenarios `SCN-NEU-01` through `SCN-NEU-06` covering cognitive neuroscience and EEG protocols.

#### [NEW] [`evals/scenarios/domains/clinical_ai.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/domains/clinical_ai.ts)

Definitions for scenarios `SCN-MED-01` through `SCN-MED-06` covering clinical AI safety and diagnostic validation.

#### [MODIFY] [`evals/scenarios/types.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/types.ts)

- Add `ResearchDomain = 'psychology' | 'psychoacoustics' | 'hci' | 'neuroscience' | 'clinical_ai'`
- Add `ResearchPhase = 'brainstorming' | 'lit_search' | 'hypothesis' | 'methodology' | 'synthesis' | 'verification'`
- Enrich `EvaluationScenario` with optional `domain?: ResearchDomain` and `phase?: ResearchPhase`.

#### [MODIFY] [`evals/scenarios/index.ts`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/index.ts)

- Import and register all 30 scenarios into [`ALL_SCENARIOS`](file:///Users/goldenfung/Documents/collaragent/evals/scenarios/index.ts#L13).
- Populate `SCENARIOS_BY_ID`, `SCENARIOS_BY_TIER`.
- Add helper query functions: `getScenariosByDomain(domain: ResearchDomain): readonly EvaluationScenario[]` and `getScenariosByPhase(phase: ResearchPhase): readonly EvaluationScenario[]`.

#### [MODIFY] [`evals/cli.ts`](file:///Users/goldenfung/Documents/collaragent/evals/cli.ts)

- Add CLI flag `--domain <domain_name>` to allow running all scenarios for a specific research domain (e.g. `yarn eval --domain psychoacoustics`).
- Wire a deterministic headless agent invoker for offline and live testing.

---

## Verification Plan

### Automated Tests

1. **Typecheck**:
   ```bash
   yarn typecheck:node
   ```
   Ensures zero `any`, strict schema compliance, and valid types.
2. **Scenario Registry Unit Tests**:
   ```bash
   npx vitest run evals/scenarios/__tests__/scenarios.test.ts
   ```
   Verifies:
   - Exactly 30 unique scenario IDs are registered.
   - All scenarios have non-empty prompts, valid tiers, and invariant rules.
   - Every scenario maps cleanly to a valid domain and research phase.
   - Lookups by ID, tier, and domain return expected counts (e.g., 6 scenarios per domain, 6 scenarios per tier).
3. **CLI Dry-Run Verification**:
   ```bash
   yarn eval --help
   yarn eval --scenario SCN-PSY-01
   yarn eval --domain psychoacoustics
   ```
   Verifies the CLI parses the domain flag and scenario IDs correctly.
