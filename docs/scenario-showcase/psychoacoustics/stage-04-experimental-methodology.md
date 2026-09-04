# Stage 4: Psychophysical Methodology & Formal Modeling

## Scenario Overview

- **Scenario ID**: `SCN-ACO-04`
- **Domain**: Psychoacoustics & Auditory Perception
- **Lifecycle Stage**: 4 (Psychophysical Methodology & Formal Modeling)
- **Primary Objective**: Detail the psychophysical staircase protocol, spatial audio rendering hardware chain, and formal mathematical models. Formulate Woodworth-Schlosberg ITD phase equations, angular velocity disparity gradients, and the Weibull cumulative psychometric function in KaTeX.
- **Participating Agent**: DeepAgent with [`apa-research-execution-specialist`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/skills/apa-research-execution-specialist/SKILL.md).
- **Workspace Tools Used**: [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799), [`editDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L820).

---

## 1. Human Researcher Intent & Prompt

```markdown
User:
Now let's draft the complete Psychoacoustic Experimental Methodology.
We need:

1. Apparatus: 6-DoF optical tracking (< 2 ms latency), Higher-Order Ambisonics (HOA 3rd order)
   binaural decoding, calibrated open-back planar headphones (Sennheiser HD 800 S).
2. Adaptive Psychophysical Staircase: Transformed 3-down / 1-up 2AFC paradigm converging to the 79.4% threshold (Levitt, 1971).
3. Formal mathematical models in KaTeX:
   - Woodworth-Schlosberg spherical head model for ITD.
   - Dynamic rate of interaural phase shift as a function of angular velocity (dITD/dt).
   - Weibull cumulative psychometric function for fitting the latency detection threshold.
4. Step-by-step trial timeline and staircase termination criteria.
```

---

## 2. Mathematical Modeling in KaTeX

### Model 1: Spherical Head Interaural Time Difference (ITD)

Using the classic Woodworth-Schlosberg spherical head model:

$$\text{ITD}(\theta) = \frac{r}{c} (\theta + \sin\theta), \quad \text{for } 0 \le \theta \le \frac{\pi}{2}$$

Where:

- $r$: Mean human head radius ($r \approx 0.0875\text{ m}$).
- $c$: Speed of sound in air at $20^\circ\text{C}$ ($c = 343\text{ m/s}$).
- $\theta$: Azimuth angle of incident sound in radians.

### Model 2: Dynamic Interaural Disparity Gradient ($d\text{ITD}/dt$)

Differentiating with respect to time yields the instantaneous rate of acoustic phase change induced by head yaw angular velocity ($\omega = \frac{d\theta}{dt}$):

$$\frac{d(\text{ITD})}{dt} = \frac{r}{c} (1 + \cos\theta) \cdot \omega(t)$$

_Theoretical Implication_: At $\theta = 0^\circ$ (front center), $\cos(0) = 1$, maximizing the disparity gradient:
$$\left.\frac{d(\text{ITD})}{dt}\right|_{\text{front}} = \frac{2r}{c} \cdot \omega$$
When head rotation speed increases from $\omega = 20^\circ/\text{s}$ ($0.35\text{ rad/s}$) to $\omega = 60^\circ/\text{s}$ ($1.05\text{ rad/s}$), the interaural temporal cue velocity triples from $0.18\text{ }\mu\text{s/ms}$ to $0.54\text{ }\mu\text{s/ms}$, dramatically sharpening the listener's ability to detect latency lag.

### Model 3: Weibull Cumulative Psychometric Function

The probability of detecting latency as lagging ($P(L)$) in a 2-Alternative Forced Choice (2AFC) task is modeled as:

$$\psi(L) = \gamma + (1 - \gamma - \lambda) \left(1 - \exp\left[-\left(\frac{L}{\alpha}\right)^\beta\right]\right)$$

Where:

- $\gamma = 0.50$: Chance guessing rate for 2AFC.
- $\lambda = 0.02$: Lapse rate (accounting for stimulus blinks or motor slips).
- $\alpha$: Threshold scale parameter (the point where detection reaches $\approx 79.4\%$).
- $\beta$: Psychometric slope parameter (indexing perceptual acuity).

---

## 3. Transformed 3-Down / 1-Up Adaptive Staircase

Following Levitt (1971), the injected motion-to-sound latency ($L_k$) updates adaptively according to listener performance:

```
[ Trial Sequence in 2AFC ]
Interval 1: Head Turn Left -> Audio plays (e.g. Reference L = 0 ms)
   Interval 2: Head Turn Left -> Audio plays (e.g. Test L = L_k)
   Listener Question: "Which interval felt sluggish or lagged behind your turn?" (1 or 2)

[ Levitt 3-Down / 1-Up Rule ]
- 3 Consecutive Correct Detections  ===> Decrease Latency: L_{k+1} = L_k - Step
- 1 Incorrect Detection            ===> Increase Latency: L_{k+1} = L_k + Step
Converges mathematically to P(Correct) = (0.5)^{1/3} = 79.4%
```

### Step Size Adaptation & Termination:

- **Initial Step Size**: $\Delta L = 16\text{ ms}$.
- **First 2 Reversals**: Step size reduced to $\Delta L = 8\text{ ms}$.
- **Subsequent Reversals**: Final step size locked at $\Delta L = 4\text{ ms}$.
- **Termination**: Exactly 8 reversal points collected per staircase run.
- **Threshold Calculation**: Mean of the final 6 reversal points defines the participant's $\text{JND}_{79.4\%}$.

---

## 4. Tool Execution: Creating the Methodology Document

The agent calls [`createDocument`](file:///Users/goldenfung/Documents/collaragent/src/collaragent/tools/WorkspaceTools.ts#L799) to persist `Psychophysical_Methodology_Protocol`:

```json
{
  "name": "Psychophysical_Methodology_Protocol",
  "project": "Psychoacoustics-Latency-Study",
  "content": {
    "root": {
      "type": "root",
      "children": [
        {
          "type": "heading",
          "tag": "h1",
          "children": [
            { "text": "Methodology: Psychophysical Evaluation of Spatial Audio Latency" }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Apparatus & Signal Processing Chain" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "Spatial audio is rendered using a 3rd-order Higher-Order Ambisonics (HOA) soundfield decoded into binaural signals via diffuse-field equalized KEMAR impulse responses. Stimuli are delivered over Sennheiser HD 800 S open-back dynamic headphones driven by an RME Fireface UCX II audio interface (24-bit, 48 kHz, 64-sample buffer = 1.33 ms audio hardware latency). 6-DoF head tracking is captured via an OptiTrack optical tracking system (4 cameras, 240 Hz, tracked latency < 1.8 ms). The total baseline motion-to-sound latency of the unperturbed system is 6.2 ms (measured via oscilloscope impulse cross-correlation)."
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Mathematical Modeling of Interaural Disparity" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "The rate of interaural temporal cue progression during head yaw is modeled via:"
            }
          ]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "$$\\frac{d(\\text{ITD})}{dt} = \\frac{r}{c} (1 + \\cos\\theta) \\cdot \\omega(t)$$"
            }
          ]
        },
        {
          "type": "heading",
          "tag": "h2",
          "children": [{ "text": "Psychophysical 2AFC Staircase Paradigm" }]
        },
        {
          "type": "paragraph",
          "children": [
            {
              "text": "Each trial presents two randomized sequential head-rotation intervals. One interval contains the pristine baseline (6.2 ms total delay), while the other introduces an added buffer latency L_k. Listeners respond via a tactile two-button response box. The staircase enforces Levitt's 3-down / 1-up rule, targeting the 79.4% threshold."
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

1. **Hardware Invariant Verification**: The researcher confirms that measuring baseline hardware latency ($6.2\text{ ms}$) via oscilloscope provides an unassailable empirical zero for the psychophysical staircase.
2. **KaTeX Invariant Check**: The researcher reviews the dynamic phase equation in the editor pane, confirming accurate notation.
3. **Approval**: The experimental methodology is approved, enabling compilation of Stage 5: Structured Scholarly Synthesis.
