#!/usr/bin/env python3
"""Stage WRIME reader-emotion colors without modifying the original audiobook.

Run after the first MVP has created web/public/stories/gongitsune/story.json:
    python pipeline/analyze_story_emotions.py

This creates story.emotions.json for review. The original story.json and
narration.wav are never modified by this script.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

MODEL_NAME = 'patrickramos/bert-base-japanese-v2-wrime-fine-tune'
MODEL_REVISION = '1f391822d6a11ccaacfff11f89935c387ffe7197'
PROJECT_ROOT = Path(__file__).resolve().parents[1]
STORY_DIR = PROJECT_ROOT / 'web' / 'public' / 'stories' / 'gongitsune'
DEFAULT_INPUT = STORY_DIR / 'story.json'
DEFAULT_OUTPUT = STORY_DIR / 'story.emotions.json'

EMOTIONS = (
    'joy', 'sadness', 'anticipation', 'surprise',
    'anger', 'fear', 'disgust', 'trust',
)
JP_LABELS = {
    'joy': '喜び', 'sadness': '悲しみ', 'anticipation': '期待',
    'surprise': '驚き', 'anger': '怒り', 'fear': '恐れ',
    'disgust': '嫌悪', 'trust': '信頼', 'neutral': '中立',
}
PALETTE = {
    'joy': '#E8C75D', 'sadness': '#6386B1',
    'anticipation': '#E1A56E', 'surprise': '#F0C181',
    'anger': '#CF6055', 'fear': '#72658E',
    'disgust': '#8A9A6C', 'trust': '#87BDA9',
}
NEUTRAL = '#96A5B0'


def clamp_score(value: float) -> float:
    # WRIME's annotation scale is 0:no, 1:weak, 2:medium, 3:strong.
    # A regression model may predict negative numbers or numbers above 3.
    return min(3.0, max(0.0, value))


def mix_hex(a: str, b: str, factor: float) -> str:
    # Simple display-only mixing toward neutral (the React UI interpolates
    # temporally in OKLab). This is not a scientifically calibrated color map.
    factor = min(1.0, max(0.0, factor))
    aa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    bb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    values = [round(x * (1 - factor) + y * factor) for x, y in zip(aa, bb)]
    return '#' + ''.join(f'{v:02X}' for v in values)


def get_color(reader_scores: dict[str, float]) -> tuple[str, str, float]:
    dominant = max(EMOTIONS, key=lambda e: reader_scores[e])
    strength = reader_scores[dominant]
    if strength < 0.3:
        return NEUTRAL, 'neutral', strength
    return mix_hex(NEUTRAL, PALETTE[dominant], strength / 3.0), dominant, strength


def main() -> int:
    parser = argparse.ArgumentParser(description='Estimate WRIME emotions for StoryChroma audiobook')
    parser.add_argument('--input', type=Path, default=DEFAULT_INPUT)
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    if args.input.resolve() == args.output.resolve():
        parser.error('出力ファイルを元の story.json に直接指定しないでください。')

    if not args.input.is_file():
        parser.error(f'作品JSONが見つかりません: {args.input}')
    story = json.loads(args.input.read_text(encoding='utf-8'))
    segments = story.get('segments')
    if not isinstance(segments, list) or not segments:
        parser.error('作品JSONにsegments配列がありません。')
    if not all(isinstance(s, dict) and isinstance(s.get('text'), str) and s['text'].strip() for s in segments):
        parser.error('segments内のtextが不正です。')

    import torch
    from transformers import AutoTokenizer, AutoModelForSequenceClassification

    print(f'モデルを読み込んでいます: {MODEL_NAME}', flush=True)
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, revision=MODEL_REVISION)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME, revision=MODEL_REVISION)
    model.eval()
    labels = {int(k): v for k, v in model.config.id2label.items()}
    expected = {f'{perspective}_{emotion}' for perspective in ('writer', 'reader') for emotion in EMOTIONS}
    if len(labels) != 16 or set(labels.values()) != expected:
        raise RuntimeError(f'想定外の出力ラベルです: {labels}')

    for i, segment in enumerate(segments, 1):
        inputs = tokenizer(
            segment['text'], return_tensors='pt',
            truncation=True, max_length=256,
        )
        with torch.inference_mode():
            values = model(**inputs).logits[0].detach().cpu().tolist()
        if len(values) != len(labels) or not all(math.isfinite(v) for v in values):
            raise RuntimeError(f'{i}番目の文の推定値が不正です。')
        raw = {labels[j]: round(float(v), 6) for j, v in enumerate(values)}
        reader_raw = {e: raw[f'reader_{e}'] for e in EMOTIONS}
        writer_raw = {e: raw[f'writer_{e}'] for e in EMOTIONS}
        reader = {e: round(clamp_score(v), 6) for e, v in reader_raw.items()}
        writer = {e: round(clamp_score(v), 6) for e, v in writer_raw.items()}
        color, primary, strength = get_color(reader)

        # Never alter segment IDs, text, timings, or the audio file.
        segment['reader_emotions'] = reader
        segment['writer_emotions'] = writer
        segment['reader_emotions_raw'] = reader_raw
        segment['writer_emotions_raw'] = writer_raw
        segment['primary_emotion'] = primary
        segment['color'] = color
        print(f'[{i:02d}/{len(segments)}] {JP_LABELS[primary]:<3} {strength:.2f}/3 '
              f'{color}  {segment["text"][:28]}', flush=True)

    story['emotion_mode'] = 'wrime_reader'
    story['emotion_model'] = MODEL_NAME
    story['emotion_model_revision'] = MODEL_REVISION
    story['emotion_model_note'] = (
        'WRIME reader scores estimate how observers interpret the writer emotion of SNS posts. '
        'These are not measured emotions of a novel reader or its characters.'
    )
    story['emotion_scale'] = 'regression: raw values retained; display values clipped to [0,3]'
    story['emotion_color_scheme'] = 'dominant reader emotion, mixed with neutral by intensity'

    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_name(args.output.name + '.tmp')
    temporary.write_text(json.dumps(story, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(args.output)
    print(f'\n解析結果を書き出しました: {args.output}')
    print('元のstory.jsonとnarration.wavは変更していません。')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'エラー: {exc}', file=sys.stderr)
        raise SystemExit(1)
