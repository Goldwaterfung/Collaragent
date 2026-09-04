# Stage 3: Hypothesis & Research Question Formulation

## Scenario Overview

- **Scenario ID**: `SCN-ACO-03`
- **Domain**: Psychoacoustics & Auditory Perception
- **Lifecycle Stage**: 3 (Hypothesis & Research Question Formulation)
- **Primary Objective**: Translate the empirical gap into formal, testable Research Questions ($RQ_1, RQ_2$) and directional psychophysical hypotheses ($H_1, H_2, H_3$). Operationalize physical acoustic parameters (angular velocity, injected buffer latency) alongside perceptual metrics (JND thresholds, azimuth RMSE, psychometric slope).
- **Participating Agent**: DeepAgent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Let's formalize our Research Questions and Hypotheses for the spatial audio latency study.
We need to test:

1. Does rotational head velocity (slow exploration vs. fast saccadic turns) sharpen latency detection?
2. Does providing a coherent 6-DoF visual anchor (a visible virtual sound source) raise the
   Just Noticeable Difference (JND) threshold for latency through cross-modal ventriloquism capture?
3. Does sub-threshold latency impair absolute spatial localization accuracy, or does degradation
   occur only once latency crosses the conscious JND threshold?

Draft this into a formal specification document with operationalized variables.
```

---

## 2. Psychophysical Operationalization Architecture

DeepAgent establishes precise physical and perceptual operationalizations:

| Variable Classification             | Construct Name                                | Operational Definition                                                                                                            | Measurement Instrument / Unit                                                                                                                                                  |
| :---------------------------------- | :-------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Independent Variable 1 ($IV_1$)** | Visual Context Modality                       | The visual reference frame available during listening.                                                                            | 2 Levels: (A) Pure Auditory Baseline (Blindfolded/Black HMD display), (B) Multimodal Coherent (6-DoF photorealistic virtual room with visible loudspeaker).                    |
| **Independent Variable 2 ($IV_2$)** | Peak Rotational Velocity ($\omega$)           | Head angular velocity around the yaw axis during target audio playback.                                                           | 2 Levels: Slow Continuous Scan ($20^\circ/\text{s} \pm 5^\circ/\text{s}$) vs. Fast Saccadic Turn ($60^\circ/\text{s} \pm 10^\circ/\text{s}$) enforced via pacing visual guide. |
| **Dependent Variable 1 ($DV_1$)**   | Latency JND Threshold ($\text{JND}_{79.4\%}$) | Injected motion-to-sound delay where participants detect latency at a 79.4% probability.                                          | Milliseconds (ms) calculated from convergence reversals of the 3-down / 1-up adaptive staircase.                                                                               |
| **Dependent Variable 2 ($DV_2$)**   | Azimuth Localization Accuracy                 | Deviation between actual virtual source angle and listener's perceived point of origin.                                           | Root-Mean-Square Error in degrees ($\text{RMSE}_\theta = \sqrt{\frac{1}{N}\sum (\theta_{\text{perceived}} - \theta_{\text{target}})^2}$).                                      |
| **Dependent Variable 3 ($DV_3$)**   | Psychometric Slope ($\beta$)                  | Sharpness of the perceptual transition from imperceptible to clearly lagging audio.                                               | Dimensionless slope parameter estimated via Maximum Likelihood fit to Weibull psychometric function.                                                                           |
| **Controlled Variables**            | Acoustic Stimulus & Room Acoustics            | Continuous anechoic pulsed pink noise (500 ms burst, 50 ms cosine ramp); fixed virtual reverberation ($RT_{60} = 0.35\text{ s}$). | Standardized ambisonic soundfield at 65 dBA Leq at listener position.                                                                                                          |

---

## 3. Formal Research Questions and Hypotheses

### Research Questions

- **$RQ_1$ (Velocity Modulation of Latency JND)**: How does increasing head angular velocity from $20^\circ/\text{s}$ to $60^\circ/\text{s}$ influence the psychophysical detection threshold ($\text{JND}_{79.4\%}$) for dynamic binaural latency?
- **$RQ_2$ (Cross-Modal Ventriloquism Capture Envelope)**: Does the co-presence of a congruent 6-DoF visual sound source expand listener tolerance for motion-to-sound latency, significantly raising the detection threshold relative to auditory-only listening?
- **$RQ_3$ (Dissociation of Detection vs. Localization Error)**: Does motion-to-sound latency below the conscious JND threshold introduce subliminal degradation to absolute sound localization accuracy?

### Falsifiable Directional Hypotheses

- **$H_1$ (Velocity Sharpening Effect)**: Higher rotational head velocity will yield significantly lower latency detection thresholds across all visual conditions, due to increased rate of ITD/ILD phase disparity change:
  $$\text{JND}_{60^\circ/\text{s}} < \text{JND}_{20^\circ/\text{s}}, \quad p < .01$$
- **$H_2$ (Visual Ventriloquism Anchoring Effect)**: The multimodal condition will exhibit a significantly higher latency detection threshold than the auditory-only baseline:
  $$\text{JND}_{\text{Multimodal}} > \text{JND}_{\text{Auditory Baseline}}, \quad \Delta \text{JND} \ge 15\text{ ms}$$
  _Theoretical Rationale_: In accordance with Alais & Burr (2004), visual spatial certainty captures the auditory spatial percept, suppressing awareness of transient dynamic acoustic lag.
- **$H_3$ (Threshold Localization Invariance)**: Injected latency below the individual listener's threshold ($L < \text{JND}$) will produce no statistically significant increase in azimuth localization error compared to the zero-latency control:
  $$\text{RMSE}_{\theta, L < \text{JND}} \approx \text{RMSE}_{\theta, L=0}, \quad p > .10$$

---

## 4. Tool Execution: Creating the Hypotheses Specification

The agent invokes [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to persist `Formal_Hypotheses_Psychoacoustics`:

```json
{
  "name": "Formal_Hypotheses_Psychoacoustics",
  "project": "Psychoacoustics-Latency-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [{ "text": "Psychophysical Hypotheses: Dynamic Spatial Audio Latency" }]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "1. Operationalized Factorial Matrix" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "The experiment adopts a 2 (Visual Context: Auditory-Only vs. Multimodal 6-DoF Anchor) x 2 (Head Rotational Velocity: 20 deg/s vs. 60 deg/s) fully repeated-measures within-subjects design. Each cell is measured via an independent adaptive psychophysical staircase."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "2. Directional Hypotheses" }]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H1 (Velocity Main Effect): ", "format": 1 },
            {
              "text": "Fast head rotations (60 deg/s) will reduce latency detection JND by at least 25% relative to slow rotations (20 deg/s) due to accelerated acoustic cue disparity rate (dITD/dt)."
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H2 (Cross-Modal Anchoring Expansion): ", "format": 1 },
            {
              "text": "The presence of a congruent 6-DoF visual sound source will significantly increase latency JND thresholds (expanding tolerance envelope by >= 15 ms) via the ventriloquism effect."
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            { "text": "H3 (Localization Independence): ", "format": 1 },
            {
              "text": "Injected latencies residing below the conscious JND threshold will not impair absolute sound localization accuracy (RMSE < 2.5 degrees)."
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

1. **Researcher Review**: The researcher reviews the psychophysical definitions in the Lexical editor.
2. **Velocity Calibration**: The researcher confirms that $20^\circ/\text{s}$ and $60^\circ/\text{s}$ match natural human head exploration boundaries documented in VR telemetry.
3. **Transition**: The hypotheses are approved, setting the stage for Stage 4: Psychophysical Methodology & KaTeX Mathematical Modeling.
