# StoryChroma

**An Interactive Audiobook with Text-Based Emotion Visualization**

StoryChroma is a web application that synchronizes Japanese
audiobook narration, text, and emotion-based color visualization.

The current implementation uses *Gongitsune* (ごん狐), a short
story by Nankichi Niimi, obtained from Aozora Bunko.

## Screenshots and Demo

### Experience

An interactive audiobook interface with synchronized Japanese text and a continuously changing emotion-based color gradient.

<a href="docs/media/storychroma-experience.webp">
  <img src="docs/media/storychroma-experience.webp" alt="StoryChroma Experience interface" width="700">
</a>

### Analysis

An analysis interface featuring emotion scores, a full-story emotion heatmap, a dominant-emotion timeline, and spatial color visualization.

<a href="docs/media/storychroma-analysis.webp">
  <img src="docs/media/storychroma-analysis.webp" alt="StoryChroma Analysis interface" width="420">
</a>

### Demo Video

[Watch the StoryChroma demo (MP4)](docs/media/storychroma-demo.mp4)

Try the interactive application: [Live Demo](https://nha6ki.github.io/StoryChroma/).

## Features

### Experience

An immersive reading and listening interface featuring:

- Full-screen, emotion-driven color gradients
- Lyrics-style, synchronized text presentation
- Audiobook playback controls

### Analysis

An interface for exploring the model's emotion estimates:

- Eight-dimensional emotion score bars
- A full-story emotion heatmap
- A dominant-emotion timeline
- A multi-point color gradient
- The complete text with sentence-level seeking

Both views share the same playback state.

## Emotion Analysis

StoryChroma uses the pretrained model:

`patrickramos/bert-base-japanese-v2-wrime-fine-tune`

The application visualizes eight emotion dimensions based on
the WRIME Reader-side predictions.

These predictions represent model estimates based on textual
input. They do not directly measure readers' emotional
experiences or establish the emotional meaning of a story.

Raw regression outputs are retained. Visualization scores
are clipped to the 0–3 range without per-emotion percentile
normalization.

## Current Content

- Work: Gongitsune (ごん狐)
- Author: Nankichi Niimi
- Text source: Aozora Bunko
- Segments: 168
- Narration: approximately 15 minutes 33 seconds
- Speech synthesis: VOICEVOX ENGINE
- Voice: Zundamon, Amaama style

## Technology

- React, TypeScript, Vite
- Python
- PyTorch and Hugging Face Transformers
- VOICEVOX ENGINE
- HTML Audio and Canvas 2D

## Run Locally

The repository includes generated narration and emotion data.
Running the existing web application does not require
regenerating them.

Requirements:

- Node.js and npm

From the repository root:

```bash
cd web
npm ci
npm run dev
```

Open the local URL reported by Vite, normally:

[http://localhost:5173/StoryChroma/](http://localhost:5173/StoryChroma/)

## Build and Lint

```
cd web
npm run build
npm run lint
```

The production build is generated in `web/dist/`.

## Project Structure

```
pipeline/    Python scripts for data preparation and inference
web/src/     React application
web/public/  Generated story data and audio
data/        Local generated and intermediate files (not tracked)
experiments/ Local visualization experiments (not tracked)
```

## Technical Design

For the implementation details, mathematical definitions, and limitations, see the [Technical Design](docs/technical-design.md).

For setup, artifact validation, and regeneration procedures, see the [Reproduction Guide](docs/reproduction.md).

## Data and Attribution

The original project source code is released under the [MIT License](LICENSE). See [Third-Party Notices](THIRD_PARTY_NOTICES.md) for the attribution and usage conditions of third-party materials and generated artifacts.

### Literary work

- Work: *Gongitsune* (ごん狐)
- Author: Nankichi Niimi (新美南吉)
- Source: [Aozora Bunko](https://www.aozora.gr.jp/cards/000121/card628.html)
- Reference edition for orthography: *Nankichi Niimi Douwashuu*, Iwanami Bunko
- Aozora Bunko notes that the edition used for the original transcription is unknown.
- Text transcription: Yuji Hayashi (林裕司)
- Proofreading: Satoshi Hamano (浜野智)

The source text is a public-domain literary work in Japan.
See the [Aozora Bunko usage guidelines](https://www.aozora.gr.jp/guide/kijyunn.html).

### Speech synthesis

- Software: [VOICEVOX](https://voicevox.hiroshiba.jp/)
- Voice: **VOICEVOX:ずんだもん**
- Style: あまあま
- Recorded engine version: 0.26.1

Generated audio is subject to the applicable
[VOICEVOX terms](https://voicevox.hiroshiba.jp/term/)
and [Zundamon voice usage terms](https://zunko.jp/con_ongen_kiyaku.html).

### Emotion model

- Model: [patrickramos/bert-base-japanese-v2-wrime-fine-tune](https://huggingface.co/patrickramos/bert-base-japanese-v2-wrime-fine-tune)
- Model publisher: patrickramos
- Listed model license: CC BY-SA 3.0
- Training dataset: WRIME

The model was trained on annotated Japanese social media posts.
Its predictions for literary sentences should not be interpreted
as validated measurements of readers' emotional responses.

## Project Status

Local development version.

The source repository and web application have not yet\
been publicly released.\
