#!/usr/bin/env python3
"""Build a complete, resumable VOICEVOX narration for Aozora Bunko's Gonkitsune.

This script deliberately writes only to data/processed/gongitsune_full (staging)
and data/processed/gongitsune_voice_cache (clip cache), leaving the working
8-sentence web demo completely untouched. Reuses tested XHTML/VOICEVOX routines
from pipeline/build_mvp.py.

Usage (from project root):
    python pipeline/build_full.py --dry-run
    python pipeline/build_full.py --speaker 1
    python pipeline/analyze_story_emotions.py \\
      --input data/processed/gongitsune_full/story.json \\
      --output data/processed/gongitsune_full/story.emotions.json
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import subprocess
import sys
import time
import wave
from datetime import datetime, timezone
from pathlib import Path

import requests

# Existing functions in the already verified EmotionSync MVP.
from build_mvp import (
    DEMO_COLORS,
    PROJECT_ROOT,
    SOURCE_URL,
    VOICEVOX_URL,
    check_speaker,
    fetch_segments,
    synthesize,
)

STAGING = PROJECT_ROOT / 'data' / 'processed' / 'gongitsune_full'
CACHE = PROJECT_ROOT / 'data' / 'processed' / 'gongitsune_voice_cache'


def wave_info(path: Path) -> tuple[tuple[int, int, int, str], int]:
    """Return (channels, width, rate, compression) and frame count; reject corrupt clips."""
    with wave.open(str(path), 'rb') as sound:
        fmt = (sound.getnchannels(), sound.getsampwidth(), sound.getframerate(), sound.getcomptype())
        count = sound.getnframes()
        if count < 1 or fmt[3] != 'NONE':
            raise ValueError(f'無効なPCM WAVです: {path}')
        # Confirm that the declared number of frames is actually readable.
        if len(sound.readframes(count)) != count * fmt[0] * fmt[1]:
            raise ValueError(f'途中で切れたWAVです: {path}')
        return fmt, count


def cache_filename(index: int, spoken: str, speaker: int, version: str) -> str:
    payload = json.dumps({'text': spoken, 'speaker': speaker, 'voicevox_version': version},
                         sort_keys=True, ensure_ascii=False)
    digest = hashlib.sha256(payload.encode('utf-8')).hexdigest()[:20]
    return f's{index:04d}_{digest}.wav'


def get_voicevox_version(session: requests.Session) -> str:
    response = session.get(f'{VOICEVOX_URL}/version', timeout=15)
    response.raise_for_status()
    return response.text.strip().strip('"')


def obtain_clip(session: requests.Session, index: int, segment: dict[str, str],
                speaker: int, version: str, cache_dir: Path, retries: int) -> tuple[Path, bool]:
    name = cache_filename(index, segment['speech_text'], speaker, version)
    path = cache_dir / name
    if path.is_file():
        try:
            wave_info(path)
            return path, True
        except (ValueError, EOFError, wave.Error):
            print(f'既存キャッシュが不正なため再生成します: {name}', flush=True)

    for attempt in range(1, retries + 1):
        try:
            wav_bytes = synthesize(session, segment['speech_text'], speaker)
            # Check synthesis response before writing it to the permanent cache.
            with wave.open(io.BytesIO(wav_bytes), 'rb') as sample:
                if sample.getnframes() == 0 or sample.getcomptype() != 'NONE':
                    raise ValueError('VOICEVOXから無効なPCM WAVが返されました。')
                sample.readframes(sample.getnframes())
            tmp = path.with_suffix('.wav.tmp')
            try:
                tmp.write_bytes(wav_bytes)
                wave_info(tmp)
                os.replace(tmp, path)
            finally:
                tmp.unlink(missing_ok=True)
            return path, False
        except (requests.RequestException, OSError, ValueError, EOFError, wave.Error) as exc:
            if attempt == retries:
                raise RuntimeError(
                    f'{index}文目の音声生成に失敗しました ({retries}回): {segment["text"][:40]}') from exc
            print(f'  再試行 {attempt}/{retries}: {exc}', flush=True)
            time.sleep(min(2 ** (attempt - 1), 8))
    raise AssertionError('unreachable')


def merge_audio(paths: list[Path], segments: list[dict[str, str]], out_dir: Path,
                speaker_name: str, speaker: int, version: str) -> tuple[Path, Path]:
    wav_out = out_dir / 'narration.wav'
    wav_part = out_dir / 'narration.wav.part'
    output_segments = []
    reference_fmt = None
    frame_cursor = 0
    try:
        with wave.open(str(wav_part), 'wb') as merged:
            for index, (wav_path, segment) in enumerate(zip(paths, segments), start=1):
                with wave.open(str(wav_path), 'rb') as sound:
                    params = sound.getparams()
                    fmt = (params.nchannels, params.sampwidth, params.framerate, params.comptype)
                    if reference_fmt is None:
                        reference_fmt = fmt
                        merged.setparams(params)
                    elif fmt != reference_fmt:
                        raise RuntimeError(f'WAV形式が一致しません: 文{index} {fmt} != {reference_fmt}')
                    count = sound.getnframes()
                    start_frame = frame_cursor
                    frame_cursor += count
                    merged.writeframes(sound.readframes(count))
                rate = reference_fmt[2]
                output_segments.append({
                    'id': f's{index:04d}',
                    'text': segment['text'],
                    'start_sec': round(start_frame / rate, 6),
                    'end_sec': round(frame_cursor / rate, 6),
                    'color': DEMO_COLORS[(index-1) % len(DEMO_COLORS)],
                })
        os.replace(wav_part, wav_out)
    finally:
        wav_part.unlink(missing_ok=True)

    assert reference_fmt is not None
    story = {
        'id': 'gongitsune',
        'title': 'ごん狐',
        'author': '新美南吉',
        'source_url': 'https://www.aozora.gr.jp/cards/000121/card628.html',
        'source_credit': '青空文庫／入力：林裕司、校正：浜野智',
        'audio_file': 'narration.mp3',
        'voice_name': speaker_name,
        'voicevox_speaker_id': speaker,
        'voicevox_version': version,
        'emotion_mode': 'demo_colors_only',
        'generated_at_utc': datetime.now(timezone.utc).isoformat(),
        'duration_sec': round(frame_cursor / reference_fmt[2], 6),
        'segments': output_segments,
    }
    # Generate a compact playback file. Since mp3 encoder delay can introduce a
    # small gap, check the actual duration independently before publication.
    mp3_out = out_dir / 'narration.mp3'
    mp3_part = out_dir / 'narration.mp3.part'
    command = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', str(wav_out), '-map', '0:a:0', '-codec:a', 'libmp3lame',
        '-b:a', '96k', '-f', 'mp3', str(mp3_part),
    ]
    try:
        subprocess.run(command, check=True)
        os.replace(mp3_part, mp3_out)
    finally:
        mp3_part.unlink(missing_ok=True)

    path_json = out_dir / 'story.json'
    part_json = out_dir / 'story.json.part'
    try:
        part_json.write_text(json.dumps(story, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        os.replace(part_json, path_json)
    finally:
        part_json.unlink(missing_ok=True)
    return path_json, mp3_out


def main() -> int:
    parser = argparse.ArgumentParser(description='EmotionSync: cached full narration of Gonkitsune')
    parser.add_argument('--speaker', type=int, default=1, help='VOICEVOX speaker style ID')
    parser.add_argument('--limit', type=int, default=0,
                        help='only the first N sentences; 0 (default) means the complete text')
    parser.add_argument('--dry-run', action='store_true',
                        help='inspect the complete extracted text without generating audio')
    parser.add_argument('--retries', type=int, default=3, help='per-clip synthesis attempts')
    args = parser.parse_args()
    if args.limit < 0 or args.retries < 1:
        parser.error('--limit must be >= 0 and --retries must be >= 1')

    print('青空文庫の本文を解析しています...', flush=True)
    all_segments = fetch_segments(10_000_000)
    if not all_segments:
        raise RuntimeError('文章が取得できませんでした。')
    segments = all_segments if args.limit == 0 else all_segments[:args.limit]
    print(f'本文から抽出: 全{len(all_segments)}文／今回処理: {len(segments)}文', flush=True)
    print(f'冒頭: {segments[0]["text"][:90]}')
    print(f'末尾: {segments[-1]["text"][:90]}')
    if args.dry_run:
        print('ドライラン完了：音声やJSONには一切変更を加えていません。')
        return 0

    session = requests.Session()
    try:
        speaker_name = check_speaker(session, args.speaker)
        version = get_voicevox_version(session)
    except requests.RequestException as exc:
        raise RuntimeError('VOICEVOX ENGINEに接続できません。Dockerコンテナを確認してください。') from exc
    print(f'VOICEVOX: {speaker_name}／エンジン: {version}', flush=True)
    STAGING.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    reused = 0
    for i, segment in enumerate(segments, start=1):
        clip_path, cached = obtain_clip(session, i, segment, args.speaker, version, CACHE, args.retries)
        reused += int(cached)
        paths.append(clip_path)
        print(f'[{i:03d}/{len(segments)}] {"再利用" if cached else "生成"} {segment["text"][:32]}', flush=True)

    story_path, mp3_path = merge_audio(paths, segments, STAGING, speaker_name, args.speaker, version)
    print(f'\n完了：{len(segments)}文（キャッシュ再利用 {reused}文）')
    print(f'作品データ: {story_path}')
    print(f'再生音声: {mp3_path}')
    print('注意：出力はステージング領域です。既存Webデモは変更していません。')
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f'エラー：{exc}', file=sys.stderr)
        raise SystemExit(1)
