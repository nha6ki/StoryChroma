# StoryChroma — Technical Design

## 1. Scope and implementation status

StoryChroma is a browser-based Japanese audiobook interface that synchronizes recorded narration, sentence-level text, and visualizations derived from a text emotion model. The current demonstration uses Nankichi Niimi's *Gongitsune* (ごん狐). It has two views, **Experience** and **Analysis**, backed by a shared HTML audio element.

This document describes the implementation observed in `web/src/App.tsx`, `pipeline/analyze_story_emotions.py`, and the reported audio-generation script structure, as of November 2026. It distinguishes implemented behavior from scientific interpretation and does not claim that the emotion predictions have been validated on literary text.

The repository contains an already generated `story.json` and `narration.mp3`. The web interface does not run the emotion model or synthesize speech at runtime.

## 2. Architecture and data flow

```text
Aozora Bunko text
      |
      v
Sentence extraction and speech-text preparation (Python)
      |
      v
VOICEVOX ENGINE -> cached sentence-level WAV clips
      |                |
      +----------------+
      v
Audio merging, sentence timestamps, MP3 encoding (FFmpeg)
      |
      v
Story JSON + narration.mp3
      |
      +----> WRIME-model inference (Python; staged JSON output)
      |             |
      |             v
      |       Reader/Writer scores
      |             |
      +-------------+  (precomputed final story.json)
                    |
                    v
      React + TypeScript + HTML Audio + Canvas 2D
             |                       |
        Experience                 Analysis
```

The inference script writes a separate JSON file rather than
overwriting its input. Its input and output paths can be specified
with `--input` and `--output`.

### Verified full-length artifact relationship

The following artifacts were compared:

| Artifact | Path | Segments |
|---|---|---:|
| Narration-stage JSON | `data/processed/gongitsune_full/story.json` | 168 |
| Emotion-analyzed JSON | `data/processed/gongitsune_full/story.emotions.json` | 168 |
| Web application JSON | `web/public/stories/gongitsune/story.json` | 168 |

The narration-stage and emotion-analyzed files have identical
segment IDs, text, and timing data. The emotion-analyzed and web application files are byte-identical,
as verified using `cmp`. They also have matching SHA-256 prefixes
(`d797561c9a0f22ea`).

The analyzed JSON therefore already contains the data required by
the web application. No additional emotion-merging algorithm is
needed. Promoting this artifact can be implemented as a validated
file copy.

The historical command used to place the final JSON in the web
directory has not been recovered. The local intermediate artifacts
are excluded from Git, so they are not available in a fresh clone.


### Main files

| Path | Role |
|---|---|
| `pipeline/build_mvp.py` | Initial short-demo text and speech generation routines |
| `pipeline/build_full.py` | Full narration with cached sentence clips and FFmpeg encoding |
| `pipeline/analyze_story_emotions.py` | Sentence-level WRIME model inference, written to a separate JSON |
| `web/public/stories/gongitsune/story.json` | Precomputed text, sentence timing, and emotion data |
| `web/public/stories/gongitsune/narration.mp3` | Precomputed narration |
| `web/src/App.tsx` | Playback, synchronization, canvas rendering, and views |
| `tests/test_story_data.py` | JSON and MP3 integrity checks |
| `.github/workflows/web-ci.yml` | Automated build, lint, and data tests |

## 3. Text, narration, and timestamps

The current story contains **168 sentence segments**, with a recorded duration of **932.608 seconds**. The final segment ends at the same timestamp. The MP3 metadata reports the same overall duration (to the millisecond shown by FFprobe), at **24 kHz**, **mono**, approximately **96 kb/s**.

`build_mvp.py` retrieves the Aozora Bunko HTML and contains sentence extraction and VOICEVOX request functions. The inspected `build_full.py` uses these routines, caches synthesized clips, validates WAV data, merges audio, records per-segment `start_sec` and `end_sec` from audio frame positions, and calls FFmpeg for MP3 encoding. The recorded synthesis configuration is **VOICEVOX ENGINE 0.26.1**, **ずんだもん / あまあま**, **speaker style ID 1**. The cache naming function accepts sentence index, speech text, style ID, and engine version.

The sentence timings are derived from generated audio rather than assumed reading rates. However, an exact full-duration match alone does not demonstrate that every text boundary is perceptually aligned with the spoken sentence. No quantitative forced-alignment or speech-recognition evaluation is established here.

## 4. Emotion model and score processing

### Model and inputs

`pipeline/analyze_story_emotions.py` loads:

`patrickramos/bert-base-japanese-v2-wrime-fine-tune`

It tokenizes each sentence separately with `truncation=True` and `max_length=256`, runs `AutoModelForSequenceClassification` in inference mode, and checks that the model supplies all **16 outputs**: eight emotions for each of the `writer` and `reader` perspectives.

The emotion dimensions are:

`joy`, `sadness`, `anticipation`, `surprise`, `anger`, `fear`, `disgust`, `trust`.

The interface uses **Reader-side estimates**. These describe a model's predictions for a perspective defined in the WRIME setting: how readers of a social-media post infer the *writer's* emotions. They are **not measurements of the actual StoryChroma user's emotional state**, nor ground-truth emotions of a fictional character or literary passage.

### Numerical handling

For a raw model output \(r_e\) for emotion \(e\), the display score is:

\[
s_e = \min(3,\max(0,r_e)).
\]

The inference script saves raw Reader and Writer values (rounded to six decimals) separately from clipped scores. The React application independently clamps `reader_emotions` into the interval \([0,3]\) before display. It does **not** apply per-emotion percentile normalization or calibrate the model's predictions to a distribution of literary-reader responses.

The Python inference script also computes a `primary_emotion` and `color` as staged metadata using its own neutral/dominant-emotion rule. **These are distinct from the browser's final eight-score OKLab gradient algorithm.** The browser recomputes its visualizations from `reader_emotions`.

## 5. Playback and temporal synchronization

The common `<audio>` element persists when switching between `#experience` and `#analysis`. Both views therefore share the audio source, playback position, play/pause state, and playback rate. The interface supports seeking by clicking a sentence, seeking on timelines, and playback speed selection.

For active-sentence highlighting, `indexAtTime` selects the last segment whose `start_sec` is at or before the current audio time (binary search). This is a **discrete, sentence-level** selection.

For the animated color field, the implementation instead interpolates between the **midpoints** of consecutive sentences:

\[
c_i = \frac{t_i^{\mathrm{start}} + t_i^{\mathrm{end}}}{2},
\qquad
\alpha = \operatorname{clamp}\!\left(\frac{t-c_i}{c_{i+1}-c_i},0,1\right),
\]
\[
\mathbf{s}(t)=(1-\alpha)\mathbf{s}_i+\alpha\mathbf{s}_{i+1}.
\]

Before the first midpoint and after the final midpoint, the nearest sentence's scores are used without extrapolation. The two interpolation semantics are intentionally different: discrete scores for sentence-oriented analysis, smooth scores for the gradient.

`requestAnimationFrame` drives updates while audio is playing. The implementation throttles visual updates to approximately **110 ms** for the gradient and **90 ms** for React playback/sentence state; event handlers additionally force synchronization during seeks and other relevant audio events. These are update thresholds, **not** guarantees of timing precision or animation frame rate.

## 6. Multi-point Gradient

### Fixed anchor arrangement

Eight fixed anchor positions follow a Plutchik-inspired clockwise ordering starting at the top:

`joy → trust → fear → surprise → sadness → disgust → anger → anticipation`.

Using normalized canvas coordinates, their positions are:

\[
\mathbf{p}_i=\left(0.5+0.335\sin\frac{i\pi}{4},\;0.5-0.335\cos\frac{i\pi}{4}\right),\qquad i=0,\ldots,7.
\]

The positions remain stationary. Only the emotion scores change as the narration progresses.

### Spatial weights

For normalized pixel position \(\mathbf{x}\) and anchor \(i\), the code precomputes an isotropic Gaussian kernel:

\[
K_i(\mathbf{x})=\exp\left(-\frac{\|\mathbf{x}-\mathbf{p}_i\|^2}{2\sigma^2}\right),
\qquad \sigma=0.27.
\]

The time-varying weight is \(w_i(\mathbf{x},t)=K_i(\mathbf{x})\,s_i(t)/3\), with score clipping to \([0,3]\).

### OKLab mixing and neutral baseline

Each of the eight fixed palette colors is converted from sRGB to OKLab. A white reference color is added with constant weight \(\beta=0.025\). For each OKLab channel, the mixed color is the weighted average:

\[
\mathbf{C}(\mathbf{x},t)=
\frac{\beta\mathbf{C}_{\mathrm{white}}+\sum_i w_i(\mathbf{x},t)\mathbf{C}_i}
{\beta+\sum_i w_i(\mathbf{x},t)}.
\]

The mixed OKLab color is converted back to sRGB. The implementation clips out-of-range RGB components rather than performing a perceptual gamut-mapping operation. The neutral contribution also prevents division by zero when every emotion score is zero.

The gradient is computed on a **320 × 180** offscreen canvas and scaled to the display canvas using Canvas 2D image smoothing. The Gaussian kernel is cached so it does not need to be recomputed when only scores change.

The palette is a **chosen visual encoding**, not a validated psychological color scale. The exact palette currently used by `App.tsx` is:

| Emotion | Hex |
|---|---|
| Joy | `#E3B849` |
| Sadness | `#557FBE` |
| Anticipation | `#E59654` |
| Surprise | `#F0C66F` |
| Anger | `#CA5B61` |
| Fear | `#8262AF` |
| Disgust | `#819458` |
| Trust | `#44A798` |

## 7. Analysis visualizations

- **Eight-score bars:** display the current active sentence's clipped Reader-side emotion scores. They do not use the midpoint interpolation used by the gradient.
- **Emotion heatmap:** uses eight fixed rows and horizontal coordinates proportional to each sentence's `start_sec` and `end_sec` relative to total duration. Within a sentence interval, the visual intensity is constant. Each color is interpolated **in RGB from white to its palette color**, with \(a=s_e/3\); this differs from the gradient's OKLab mixing.
- **Dominant-emotion track:** colors every sentence interval with the palette color corresponding to its largest Reader score. It chooses an emotion even when all scores are small. Ties are resolved by the order of the `EMOTIONS` array.
- **Full transcript:** highlights the active sentence and permits sentence-start seeking. A control scrolls to the current sentence in Analysis. Experience uses an automatically following, lyrics-like presentation.

The heatmap, dominant track, and sentence bars should not be described as visualizations of temporally interpolated model outputs. Only the gradient uses the midpoint-interpolated emotion vector.

## 8. Verification performed

- Web: TypeScript/Vite production build and Oxlint succeed locally and in GitHub Actions.
- JSON: 168 segments; nonempty text; finite Reader/Writer values; ordered positive sentence intervals; final end time matches recorded duration; referenced MP3 exists.
- MP3: FFprobe reports **932.608 s**; `story.json` and the last segment end at **932.608 s**; FFmpeg successfully decodes the complete file.
- CI: the Python standard-library `unittest` suite includes five checks, including MP3 duration within 0.1 s and successful FFmpeg decoding. The workflow uses Ubuntu 24.04 for the audio tests.
- The user has previously confirmed that the two-view application works in a browser. No automated browser-based end-to-end suite is established.

## 9. Reproducibility and limits

The repository includes the final audio and JSON, so running the existing browser experience needs Node.js and npm but **does not** require executing BERT or VOICEVOX locally.

The generation pipeline requires additional components, including the pinned Python packages in `pipeline/requirements.txt`, FFmpeg, a running VOICEVOX ENGINE, and access to the text and model sources. The recorded local environment used Python 3.14.4, PyTorch 2.15.0, Transformers 5.22.2, FFmpeg 8.0.1, and VOICEVOX ENGINE 0.26.1. Package-version recording **does not** establish bitwise-reproducible output. In particular, the model repository revision and complete speech-generation settings have not been verified as pinned in source control. The existing analyzed and final JSON artifacts have been matched, but their historical promotion command has not been recovered.

Further limitations:

1. The model is applied outside the original short social-media-post setting; its validity for this literary text has not been established by an independent evaluation.
2. The WRIME Reader perspective is a prediction of perceived writer emotion, not a measure of the listener's affect.
3. Sentence segmentation and speech synthesis determine temporal boundaries; no forced alignment or per-boundary acoustic evaluation has been reported.
4. Colors and spatial anchor positions are application-specific visual encodings, not scientifically calibrated relationships between emotions and colors.
5. The time series is interpolated between sentence-level estimates; intermediate color changes are visualization design decisions, not additional model predictions.
6. Browser rendering performance and visual accessibility across devices have not been formally benchmarked.

## 10. Attribution

The demo's literary text is *Gongitsune* by Nankichi Niimi, sourced from Aozora Bunko. Speech uses **VOICEVOX:ずんだもん** (あまあま). The model identifier is `patrickramos/bert-base-japanese-v2-wrime-fine-tune`. See the repository's [README](../README.md) for source links and attribution details. Licensing and redistribution requirements should be reviewed independently before public deployment.
