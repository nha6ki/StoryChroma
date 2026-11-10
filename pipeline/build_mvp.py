#!/usr/bin/env python3
"""Generate a short Gonkitsune demo using Aozora Bunko and local VOICEVOX ENGINE.

Run from any working directory:
    python pipeline/build_mvp.py --speaker 1 --limit 8

No cloud APIs, keys, or file overwrites outside web/public/stories/gongitsune.
The colors are DEMO COLORS, not predictions of emotion.
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import wave
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import requests
from bs4 import BeautifulSoup

SOURCE_URL = "https://www.aozora.gr.jp/cards/000121/files/628_14895.html"
VOICEVOX_URL = "http://127.0.0.1:50021"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "web" / "public" / "stories" / "gongitsune"

# Artificial colors for checking synchronization. NOT outputs of emotion analysis.
DEMO_COLORS = ["#70AFA8", "#8AA6B5", "#D4B471", "#B78D78", "#A28EBC", "#7398B3", "#8BBCA6", "#CE9E7D"]
SENTENCE_PATTERN = re.compile(r"[^。！？]*[。！？][」』）]*|[^。！？]+$")


def clean_text(text: str) -> str:
    return re.sub(r"[\r\n\t]", "", text).strip(" \u3000")


def sentences(text: str) -> list[str]:
    return [s for s in (clean_text(m.group(0)) for m in SENTENCE_PATTERN.finditer(text)) if s]


def paragraph_pair(paragraph) -> tuple[str, str]:
    # Keep the original ruby base glyphs in display text.
    display = BeautifulSoup(str(paragraph), "html.parser")
    for tag in display.select("rt, rp"):
        tag.decompose()

    # For speech, use the ruby reading when it is explicitly specified.
    spoken = BeautifulSoup(str(paragraph), "html.parser")
    for ruby in list(spoken.select("ruby")):
        reading = ruby.find("rt")
        if reading and reading.get_text(strip=True):
            ruby.replace_with(reading.get_text(strip=True))
        else:
            for tag in ruby.find_all(["rp", "rt"]):
                tag.decompose()
            ruby.unwrap()
    return clean_text(display.get_text()), clean_text(spoken.get_text())


def fetch_segments(limit: int) -> list[dict[str, str]]:
    response = requests.get(SOURCE_URL, timeout=30)
    response.raise_for_status()
    # The Aozora Bunko XHTML for this particular edition is encoded in Shift_JIS.
    try:
        html = response.content.decode("shift_jis")
    except UnicodeDecodeError:
        html = response.content.decode("cp932")
    soup = BeautifulSoup(html, "html.parser")
    main = soup.select_one("div.main_text")
    if main is None:
        raise RuntimeError("青空文庫の本文領域を検出できませんでした。元ページのHTMLを確認してください。")

    # Newer Aozora XHTML often uses <p>, whereas this edition of
    # Gonkitsune separates paragraphs using <br /> directly in main_text.
    paragraphs = list(main.select("p"))
    if not paragraphs:
        paragraphs = []
        for fragment in re.split(r"<br\s*/?>", main.decode_contents(), flags=re.IGNORECASE):
            line = BeautifulSoup(fragment, "html.parser")
            for heading in line.select("h1, h2, h3, h4, h5, h6"):
                heading.decompose()
            if line.get_text(strip=True):
                paragraphs.append(line)

    result: list[dict[str, str]] = []
    for paragraph in paragraphs:
        visual, speech = paragraph_pair(paragraph)
        if not visual:
            continue
        visuals, speeches = sentences(visual), sentences(speech)
        if len(visuals) != len(speeches):
            raise RuntimeError(f"ルビ変換後に文数が一致しません。\n表示：{visual}\n読み：{speech}")
        for v, s in zip(visuals, speeches):
            result.append({"text": v, "speech_text": s})
            if len(result) >= limit:
                return result
    if not result:
        raise RuntimeError("本文が取得できませんでした。青空文庫のXHTMLを確認してください。")
    return result


def check_speaker(session: requests.Session, speaker_id: int) -> str:
    response = session.get(f"{VOICEVOX_URL}/speakers", timeout=15)
    response.raise_for_status()
    speakers = response.json()
    available: list[tuple[str, int]] = []
    for speaker in speakers:
        for style in speaker.get("styles", []):
            available.append((f"{speaker['name']} / {style['name']}", style["id"]))
    for name, sid in available:
        if sid == speaker_id:
            return name
    listing = ", ".join(f"{id_}:{name}" for name, id_ in available[:15])
    raise ValueError(f"speaker={speaker_id} は存在しません。使用可能な例：{listing}")


def synthesize(session: requests.Session, text: str, speaker: int) -> bytes:
    query_response = session.post(
        f"{VOICEVOX_URL}/audio_query",
        params={"text": text, "speaker": speaker},
        timeout=90,
    )
    query_response.raise_for_status()
    synthesis_response = session.post(
        f"{VOICEVOX_URL}/synthesis",
        params={"speaker": speaker},
        json=query_response.json(),
        timeout=180,
    )
    synthesis_response.raise_for_status()
    return synthesis_response.content


def build(speaker: int, limit: int) -> None:
    session = requests.Session()
    try:
        voice_name = check_speaker(session, speaker)
    except requests.RequestException as exc:
        raise RuntimeError("VOICEVOX ENGINEに接続できません。Dockerを起動してから実行してください。") from exc

    segments = fetch_segments(limit)
    print(f"取得：{len(segments)} 文 / 音声：{voice_name}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    wav_path = OUTPUT_DIR / "narration.wav"
    json_path = OUTPUT_DIR / "story.json"

    wave_params = None
    sample_cursor = 0
    output_segments = []
    with wave.open(str(wav_path), "wb") as merged:
        for index, segment in enumerate(segments):
            audio_bytes = synthesize(session, segment["speech_text"], speaker)
            with wave.open(io.BytesIO(audio_bytes), "rb") as clip:
                params = clip.getparams()
                current_config = (params.nchannels, params.sampwidth, params.framerate, params.comptype)
                if wave_params is None:
                    wave_params = current_config
                    merged.setparams(params)
                elif wave_params != current_config:
                    raise RuntimeError("音声形式が途中で変化しました。全WAVの設定を統一してください。")
                frames = clip.getnframes()
                merged.writeframes(clip.readframes(frames))

            assert wave_params is not None
            rate = wave_params[2]
            start_frame = sample_cursor
            sample_cursor += frames
            output_segments.append({
                "id": f"s{index+1:04d}",
                "text": segment["text"],
                "start_sec": round(start_frame / rate, 6),
                "end_sec": round(sample_cursor / rate, 6),
                "color": DEMO_COLORS[index % len(DEMO_COLORS)],
            })
            print(f"  [{index+1}/{len(segments)}] {segment['text'][:26]}…")

    rate = wave_params[2]
    story = {
        "id": "gongitsune",
        "title": "ごん狐",
        "author": "新美南吉",
        "source_url": "https://www.aozora.gr.jp/cards/000121/card628.html",
        "source_credit": "青空文庫／入力：林裕司、校正：浜野智",
        "audio_file": "narration.wav",
        "voice_name": voice_name,
        "emotion_mode": "demo_colors_only",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "duration_sec": round(sample_cursor / rate, 6),
        "segments": output_segments,
    }
    json_path.write_text(json.dumps(story, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"生成完了：{json_path}")
    print(f"生成完了：{wav_path}")
    print("注意：色は同期確認用の仮色であり、感情分析結果ではありません。")


def main() -> int:
    parser = argparse.ArgumentParser(description="StoryChroma first synchronized demo")
    parser.add_argument("--speaker", type=int, default=1, help="VOICEVOX style ID from /speakers")
    parser.add_argument("--limit", type=int, default=8, help="number of sentences from the beginning (1-25)")
    args = parser.parse_args()
    if not 1 <= args.limit <= 25:
        parser.error("--limit must be between 1 and 25")
    try:
        build(speaker=args.speaker, limit=args.limit)
    except Exception as exc:
        print(f"エラー：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
