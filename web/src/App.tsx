import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './App.css';

type EmotionName = 'joy' | 'sadness' | 'anticipation' | 'surprise' | 'anger' | 'fear' | 'disgust' | 'trust' | 'neutral';
type ColorMode = 'original' | 'category';

type Segment = {
  id: string;
  text: string;
  start_sec: number;
  end_sec: number;
  color: string;
  primary_emotion?: string;
  reader_emotions?: Record<string, number>;
};

type Story = {
  id: string;
  title: string;
  author: string;
  source_url: string;
  source_credit: string;
  voice_name: string;
  emotion_mode: string;
  audio_file: string;
  duration_sec: number;
  segments: Segment[];
};

const ASSET_ROOT = `${import.meta.env.BASE_URL}stories/gongitsune/`;
const DEFAULT_COLOR = '#8AA7B5';

const EMOTION_NAMES: Record<EmotionName, string> = {
  joy: '喜び',
  sadness: '悲しみ',
  anticipation: '期待',
  surprise: '驚き',
  anger: '怒り',
  fear: '恐れ',
  disgust: '嫌悪',
  trust: '信頼',
  neutral: '中立',
};

// 「カテゴリ強調」モード用。感情強度はこの色には反映せず、数値で別表示する。
const CATEGORY_COLORS: Record<EmotionName, string> = {
  joy: '#E3B849',
  sadness: '#557FBE',
  anticipation: '#E59654',
  surprise: '#F0C66F',
  anger: '#CA5B61',
  fear: '#8262AF',
  disgust: '#819458',
  trust: '#44A798',
  neutral: '#A1AAB2',
};

function knownEmotion(value: string | undefined): EmotionName {
  if (value && Object.prototype.hasOwnProperty.call(EMOTION_NAMES, value)) {
    return value as EmotionName;
  }
  return 'neutral';
}

function labelTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const sec = Math.floor(seconds);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// start_secの二分探索。セグメント間の短い無音でも直前の文を維持する。
function indexForTime(segments: Segment[], seconds: number): number {
  if (segments.length === 0) return -1;
  let lo = 0;
  let hi = segments.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (segments[mid].start_sec <= seconds) lo = mid + 1;
    else hi = mid;
  }
  return clamp(lo - 1, 0, segments.length - 1);
}

function colorAtTime(centers: number[], colors: string[], time: number): string {
  if (colors.length === 0) return DEFAULT_COLOR;
  if (colors.length === 1 || time <= centers[0]) return colors[0];
  const last = centers.length - 1;
  if (time >= centers[last]) return colors[last];
  let lo = 1;
  let hi = last;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (centers[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const before = lo - 1;
  const denominator = centers[lo] - centers[before];
  const ratio = denominator > 0 ? clamp((time - centers[before]) / denominator, 0, 1) : 1;
  return `color-mix(in oklab, ${colors[before]} ${((1 - ratio) * 100).toFixed(2)}%, ${colors[lo]})`;
}

function timelineGradient(centers: number[], colors: string[], duration: number): string {
  if (colors.length === 0) return `linear-gradient(90deg, ${DEFAULT_COLOR}, ${DEFAULT_COLOR})`;
  const span = duration > 0 ? duration : 1;
  const stops = [`${colors[0]} 0%`];
  centers.forEach((center, index) => {
    stops.push(`${colors[index]} ${(100 * clamp(center / span, 0, 1)).toFixed(3)}%`);
  });
  stops.push(`${colors[colors.length - 1]} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const sentenceRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const frameRef = useRef<number>(0);
  const lastPaintRef = useRef<number>(0);

  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [active, setActive] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [colorMode, setColorMode] = useState<ColorMode>('category');
  const [autoFollow, setAutoFollow] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`${ASSET_ROOT}story.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`作品データの取得に失敗しました (HTTP ${response.status})`);
        return response.json() as Promise<Story>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!Array.isArray(data.segments) || !data.segments.length || !(data.duration_sec > 0)) {
          throw new Error('作品データの形式が不正です（文または再生時間がありません）');
        }
        setStory(data);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => { cancelled = true; };
  }, []);

  const centers = useMemo(
    () => story?.segments.map((s) => (s.start_sec + s.end_sec) / 2) ?? [],
    [story],
  );
  const colors = useMemo(
    () => story?.segments.map((s) => (
      colorMode === 'original'
        ? (s.color || DEFAULT_COLOR)
        : CATEGORY_COLORS[knownEmotion(s.primary_emotion)]
    )) ?? [],
    [story, colorMode],
  );
  const gradient = useMemo(
    () => timelineGradient(centers, colors, story?.duration_sec ?? 1),
    [centers, colors, story],
  );

  const sync = useCallback((force = false) => {
    const audio = audioRef.current;
    if (!audio || !story) return;
    const now = audio.currentTime;
    pageRef.current?.style.setProperty('--emotion-color', colorAtTime(centers, colors, now));
    const frameTime = performance.now();
    if (force || frameTime - lastPaintRef.current >= 95) {
      setTime(now);
      setActive(indexForTime(story.segments, now));
      lastPaintRef.current = frameTime;
    }
  }, [story, centers, colors]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      sync();
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [playing, sync]);

  useEffect(() => { sync(true); }, [sync]);

  useEffect(() => {
    if (!autoFollow || !story) return;
    const reader = readerRef.current;
    const target = sentenceRefs.current[active];
    if (!reader || !target) return;

    const readerRect = reader.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const margin = 48;
    if (targetRect.top >= readerRect.top + margin && targetRect.bottom <= readerRect.bottom - margin) return;

    const relative = targetRect.top - readerRect.top;
    const destination = Math.max(0, reader.scrollTop + relative - (reader.clientHeight - targetRect.height) / 2);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    reader.scrollTo({ top: destination, behavior: reduceMotion ? 'instant' : 'smooth' });
  }, [active, autoFollow, story]);

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !story) return;
    const audioLimit = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration : story.duration_sec;
    audio.currentTime = clamp(seconds, 0, Math.min(story.duration_sec, audioLimit));
    sync(true);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
      setError('');
    } catch (reason: unknown) {
      setError(`音声を再生できません：${String(reason)}`);
    }
  };

  const current = story?.segments[active];
  const currentEmotion = knownEmotion(current?.primary_emotion);
  const currentScoreRaw = current?.reader_emotions?.[currentEmotion];
  const currentScore = Number.isFinite(currentScoreRaw) ? clamp(currentScoreRaw as number, 0, 3) : null;

  return (
    <div className="page" ref={pageRef}>
      <div className="ambient" aria-hidden="true" />
      <main className="app-shell">
        <header className="masthead">
          <div>
            <div className="brand">EMOTIONSYNC <span>· INTERACTIVE AUDIOBOOK</span></div>
            <h1>{story?.title ?? 'ごん狐'}</h1>
            <p className="byline">{story?.author ?? '新美南吉'}</p>
          </div>
          <div className="mode-label">
            <span>テキスト × 感情推定 × 朗読同期</span>
            <strong>{story?.emotion_mode === 'wrime_reader' ? 'Japanese BERT / WRIME' : '色の同期デモ'}</strong>
          </div>
        </header>

        {error && <div className="error" role="alert">{error}</div>}
        {!story ? (
          <div className="loading">作品データを読み込んでいます。作品ファイル未生成の場合はPython側の処理を確認してください。</div>
        ) : (
          <>
            <section className="visual-stage" aria-label="現在の場面の感情色">
              <div className="stage-orb" aria-hidden="true" />
              <div className="stage-content">
                <p className="stage-eyebrow">NOW READING · {active + 1} / {story.segments.length}</p>
                <p className="stage-emotion">{story.emotion_mode === 'wrime_reader' ? EMOTION_NAMES[currentEmotion] : '感情色'}</p>
                <p className="stage-current-text">{current?.text ?? ''}</p>
                <p className="stage-meta">
                  {currentScore === null ? '文章と音声に同期しています' : `WRIME推定強度 ${currentScore.toFixed(2)} / 3`}
                </p>
              </div>
            </section>

            <section className="control-panel" aria-label="音声再生コントロール">
              <div className="control-head">
                <div>
                  <h2>感情カラー・タイムライン</h2>
                  <p>{story.segments.length}文 · {labelTime(story.duration_sec)} · 文をクリックして移動</p>
                </div>
                <span className="display-mode-indicator">{colorMode === 'category' ? 'カテゴリ強調' : '解析色'}</span>
              </div>

              <div className="gradient-track" style={{ backgroundImage: gradient }}>
                <input
                  aria-label="再生位置"
                  type="range"
                  min={0}
                  max={story.duration_sec}
                  step={0.05}
                  value={clamp(time, 0, story.duration_sec)}
                  onChange={(event) => seek(Number(event.target.value))}
                />
              </div>
              <div className="time-row"><span>{labelTime(time)}</span><span>{labelTime(story.duration_sec)}</span></div>

              <div className="player-controls">
                <div className="play-buttons">
                  <button type="button" className="primary-button" onClick={togglePlayback}>
                    {playing ? '一時停止' : '再生する'}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => seek(0)}>先頭へ</button>
                  <button type="button" className="secondary-button" onClick={() => seek(story.segments[Math.max(0, active - 1)].start_sec)}>前の文</button>
                  <button type="button" className="secondary-button" onClick={() => seek(story.segments[Math.min(story.segments.length - 1, active + 1)].start_sec)}>次の文</button>
                </div>
                <label className="speed">再生速度
                  <select value={speed} onChange={(event) => {
                    const next = Number(event.target.value);
                    setSpeed(next);
                    if (audioRef.current) audioRef.current.playbackRate = next;
                  }}>
                    {[0.75, 1, 1.25, 1.5].map((value) => (
                      <option key={value} value={value}>{value}×</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="options-row">
                <fieldset className="mode-toggle">
                  <legend>色の表示方法</legend>
                  <label><input type="radio" name="color-mode" checked={colorMode === 'category'} onChange={() => setColorMode('category')} />カテゴリ強調</label>
                  <label><input type="radio" name="color-mode" checked={colorMode === 'original'} onChange={() => setColorMode('original')} />解析色（元の色）</label>
                </fieldset>
                <label className="follow-option">
                  <input type="checkbox" checked={autoFollow} onChange={(event) => setAutoFollow(event.target.checked)} />
                  朗読位置へ自動スクロール
                </label>
              </div>
              <p className="mode-note">
                {colorMode === 'category'
                  ? 'カテゴリ強調は感情の種類を見分けやすくする表示です。強度は色に反映せず、数値で示します。'
                  : '解析色は既存のJSONに保存された色を、そのまま使用しています。'}
              </p>

              <audio
                ref={audioRef}
                src={`${ASSET_ROOT}${story.audio_file}`}
                preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); sync(true); }}
                onEnded={() => { setPlaying(false); sync(true); }}
                onTimeUpdate={() => sync(true)}
                onSeeked={() => sync(true)}
                onLoadedMetadata={() => sync(true)}
                onError={() => setError(`音声ファイルを読み込めません：${story.audio_file}`)}
              />
            </section>

            <section className="reader-section" aria-label="朗読テキスト">
              <div className="reader-head">
                <div>
                  <h2>本文</h2>
                  <p>再生中の文章をハイライトします。文章のクリックでその位置に移動できます。</p>
                </div>
                <span>SCENE {String(active + 1).padStart(3, '0')}</span>
              </div>
              <div ref={readerRef} className="reader" role="region" aria-label="本文スクロール領域" tabIndex={0}>
                {story.segments.map((segment, index) => (
                  <button
                    type="button"
                    className={`sentence ${index === active ? 'active' : ''}`}
                    key={segment.id}
                    ref={(node) => { sentenceRefs.current[index] = node; }}
                    onClick={() => seek(segment.start_sec)}
                    aria-current={index === active ? 'true' : undefined}
                    title={`第${index + 1}文から再生`}
                  >
                    {segment.text}
                  </button>
                ))}
              </div>
            </section>

            <footer className="footer">
              <p>朗読音声：{story.voice_name}（VOICEVOX）<br />
                <a href={story.source_url} target="_blank" rel="noreferrer">原文：青空文庫</a> ／ {story.source_credit}</p>
              <p>{story.emotion_mode === 'wrime_reader'
                ? '感情色はJapanese BERT（WRIME）が推定した、文中の書き手感情を読み手が推測する強度に基づく試作表現です。物語の客観的な感情や読者の実際の感情を示すものではありません。'
                : '感情色は同期検証用です。感情分析結果ではありません。'}
              </p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
