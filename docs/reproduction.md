# StoryChroma — Reproduction Guide

## Scope

This guide distinguishes three tasks:

1. Running the existing web application.
2. Validating the committed story and audio artifacts.
3. Regenerating narration and emotion data in an isolated working copy.

The repository already includes the generated JSON and MP3.
Neither Python nor VOICEVOX is required to run the existing web app.

For mathematical details and validation results, see
[Technical Design](technical-design.md).

## 1. Run the existing application

Requirements: Node.js and npm.

From the repository root:

```bash
cd web
npm ci
npm run dev
```

Open the URL reported by Vite, usually
`http://localhost:5173/`.

For a production build and static analysis:

```bash
npm run build
npm run lint
```

## 2. Validate existing artifacts

From the repository root:

```bash
python3 -m unittest discover \
  -s tests -p "test_*.py" -v
```

The five tests check JSON structure, sentence timestamps,
emotion values, MP3 duration, and MP3 decoding.

These tests require FFmpeg and FFprobe on PATH.

The existing artifacts have separately been verified:

- 168 sentence segments.
- 2,688 raw emotion values reproduced to six decimal places.
- 168 cached WAV clips matching the merged WAV PCM data.
- Sentence timestamps matching cumulative PCM frame positions.
- Total narration duration: 932.608 seconds.
- Analyzed JSON and web JSON are byte-identical.
- Generated MP3 and web MP3 are byte-identical.

These findings concern the existing artifacts. They do not
establish bitwise reproducibility of a new synthesis run.

## 3. Python environment for regeneration

The verified local inference environment used:

| Component | Version |
|---|---|
| Python | 3.14.4 |
| PyTorch | 2.15.0+cu132 |
| Transformers | 5.22.2 |
| Tokenizers | 0.23.3 |
| Safetensors | 0.8.0 |
| Inference device | CPU |

Dependencies are listed in `pipeline/requirements.txt`.

In an isolated working copy with compatible Python:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r pipeline/requirements.txt
.venv/bin/python -m pip check
```

Installation requires package downloads and may differ by
platform or available PyTorch wheels. The requirements file
records package versions, but does not lock all transitive
dependencies or the exact wheel builds.

## 4. VOICEVOX ENGINE

The audio-generation scripts expect a local HTTP API at:

`http://127.0.0.1:50021`

Recorded synthesis metadata:

- Engine version: 0.26.1
- Voice: Zundamon (ずんだもん)
- Style: Amaama (あまあま)
- Speaker style ID: 1

The pipeline requests an AudioQuery and submits the returned
query to the synthesis endpoint without overriding individual
synthesis parameters.

VOICEVOX's official Docker instructions are available at:

https://github.com/VOICEVOX/voicevox_engine

The original Docker image digest and startup command are
not recorded in this repository. The moving `cpu-latest`
tag must not be treated as a pinned historical version.

Before attempting synthesis, verify a running engine:

```bash
curl -fsS http://127.0.0.1:50021/version
curl -fsS http://127.0.0.1:50021/speakers
```

Check that the expected engine version and speaker style
are available.

## 5. Regenerate narration — destructive to staging outputs

WARNING: `build_full.py` uses fixed local output directories:

- `data/processed/gongitsune_full/`
- `data/processed/gongitsune_voice_cache/`

A normal run can replace existing staging artifacts.
Do not execute it in the original working directory
without preserving those files.

Use a separate disposable clone or equivalent isolated
working copy. Ensure Python, FFmpeg, the source website,
and VOICEVOX ENGINE are available.

Inspect the text extraction first:

```bash
.venv/bin/python pipeline/build_full.py --dry-run
```

To generate the narration in the isolated working copy:

```bash
.venv/bin/python pipeline/build_full.py --speaker 1
```

This produces staging outputs, including:

- `gongitsune_full/story.json`
- `gongitsune_full/narration.wav`
- `gongitsune_full/narration.mp3`

The script caches sentence-level WAV clips. Cache keys
incorporate speech text, speaker ID, and engine version.
They do not contain the complete AudioQuery.

## 6. Regenerate emotion predictions

The model is:

`patrickramos/bert-base-japanese-v2-wrime-fine-tune`

Pinned future-inference revision:

`1f391822d6a11ccaacfff11f89935c387ffe7197`

Run in the isolated working copy:

```bash
.venv/bin/python pipeline/analyze_story_emotions.py \
  --input data/processed/gongitsune_full/story.json \
  --output data/processed/gongitsune_full/story.emotions.json
```

The output contains Reader and Writer predictions for
eight emotions. Raw regression values are retained;
display values are clipped to [0, 3].

The original 168-sentence data was numerically reproduced
at six-decimal precision using the pinned revision and
the verified local CPU environment.

## 7. Validate and promote newly generated artifacts

The web application reads:

- `web/public/stories/gongitsune/story.json`
- `web/public/stories/gongitsune/narration.mp3`

Before replacing either file:

1. Verify the staging JSON and MP3.
2. Confirm sentence IDs, text, timestamps, and emotion fields.
3. Compare the narration duration with the JSON duration.
4. Preserve the existing web artifacts for rollback.
5. Copy validated files only inside the isolated working copy.
6. Run the five tests and the web build.

There is no automatic promotion step in the current pipeline.

Do not assume that regenerated files will have identical
hashes. Source text, synthesis defaults, encoder versions,
and generation timestamps can affect the outputs.

## 8. Known reproducibility limitations

- The exact historical VOICEVOX Docker image is unknown.
- The complete original AudioQuery parameters were not retained.
- The historical FFmpeg encoder version is unconfirmed.
- Sentence-level timestamps reflect concatenated audio frames,
  not independently evaluated word-level forced alignment.
- The source website may change over time.
- Model predictions are not validated measurements of the
  emotions experienced by literary readers.
- The documented numerical reproduction was performed in the
  specified local environment; cross-platform equivalence
  has not been established.
