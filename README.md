# StoryChroma

**An Interactive Audiobook with Text-Based Emotion Visualization**

StoryChroma is a web application that synchronizes Japanese
audiobook narration, text, and emotion-based color visualization.

The current implementation uses *Gongitsune* (ごん狐), a short
story by Nankichi Niimi, obtained from Aozora Bunko.

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

[http://localhost:5173/](http://localhost:5173/)

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

## Data and Attribution

Text source:

- Nankichi Niimi, Gongitsune
- Aozora Bunko:\
  [https://www.aozora.gr.jp/cards/000121/card628.html](https://www.aozora.gr.jp/cards/000121/card628.html)

Emotion model:

\- [https://huggingface.co/patrickramos/bert-base-japanese-v2-wrime-fine-tune](https://huggingface.co/patrickramos/bert-base-japanese-v2-wrime-fine-tune)

Speech synthesis:

- VOICEVOX ENGINE
- Voice library: Zundamon

The text source, pretrained model, VOICEVOX software, and\
voice library have separate attribution and licensing\
requirements. These must be verified before public deployment\
or redistribution.

## Project Status

Local development version.

The source repository and web application have not yet\
been publicly released.\
