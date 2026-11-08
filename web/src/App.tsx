import { useCallback, useEffect, useRef, useState } from 'react';
import './App.css';

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

const assetRoot = `${import.meta.env.BASE_URL}stories/gongitsune/`;

const emotionNames: Record<string, string> = {
  joy: '喜び', sadness: '悲しみ', anticipation: '期待',
  surprise: '驚き', anger: '怒り', fear: '恐れ',
  disgust: '嫌悪', trust: '信頼', neutral: '中立',
};

function labelTime(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function indexForTime(segments: Segment[], time: number): number {
  if (!segments.length) return -1;
  const i = segments.findIndex((s) => time >= s.start_sec && time < s.end_sec);
  return i === -1 ? segments.length - 1 : i;
}

function emotionColor(segments: Segment[], time: number): string {
  if (segments.length === 0) return '#769EAA';
  const centers = segments.map((s) => (s.start_sec + s.end_sec) / 2);
  if (time <= centers[0]) return segments[0].color;
  for (let i = 1; i < segments.length; i++) {
    if (time <= centers[i]) {
      const ratio = (time - centers[i - 1]) / (centers[i] - centers[i - 1]);
      const a = (100 * (1 - ratio)).toFixed(2);
      const b = (100 * ratio).toFixed(2);
      return `color-mix(in oklab, ${segments[i - 1].color} ${a}%, ${segments[i].color} ${b}%)`;
    }
  }
  return segments[segments.length - 1].color;
}

function storyGradient(story: Story): string {
  const duration = story.duration_sec || 1;
  const stops = story.segments.map((s) => {
    const center = (s.start_sec + s.end_sec) / 2;
    return `${s.color} ${(100 * center / duration).toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

export default function App() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ambientRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<number>(0);
  const lastPaintRef = useRef<number>(0);
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [active, setActive] = useState(0);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    let cancelled = false;
    fetch(`${assetRoot}story.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`作品データの取得に失敗しました (HTTP ${response.status})`);
        return response.json() as Promise<Story>;
      })
      .then((data) => { if (!cancelled) setStory(data); })
      .catch((exc: unknown) => { if (!cancelled) setError(String(exc)); });
    return () => { cancelled = true; };
  }, []);

  const sync = useCallback((force = false) => {
    const audio = audioRef.current;
    if (!audio || !story) return;
    const now = audio.currentTime;
    if (ambientRef.current) {
      ambientRef.current.style.backgroundColor = emotionColor(story.segments, now);
    }
    const frameTime = performance.now();
    if (force || frameTime - lastPaintRef.current >= 90) {
      setTime(now);
      setActive(indexForTime(story.segments, now));
      lastPaintRef.current = frameTime;
    }
  }, [story]);

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

  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !story) return;
    audio.currentTime = Math.max(0, Math.min(seconds, story.duration_sec));
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
    } catch (exc) {
      setError(`音声を再生できません：${String(exc)}`);
    }
  };

  return (
    <div className="page">
      <div ref={ambientRef} className="ambient" aria-hidden="true" />
      <main className="app-shell">
        <header className="masthead">
          <div><div className="brand">EMOTIONSYNC <span>· DEMO 01</span></div>
            <h1>{story?.title ?? 'ごん狐'}</h1>
            <p className="byline">{story?.author ?? '新美南吉'}</p>
          </div>
          <div className="mode-label">音声・文章・色の同期検証<br /><strong>{story?.emotion_mode === 'wrime_reader'
            ? '日本語BERT（WRIME）の推定色' : '仮の色：感情推定は未実装'}</strong></div>
        </header>

        {error && <div className="error" role="alert">{error}</div>}
        {!story ? <div className="loading">作品データを読み込んでいます。<br />データ未生成の場合はPythonスクリプトを先に実行してください。</div> : (
          <>
            <section className="reader" aria-label="読み上げテキスト">
              {story.segments.map((s, i) => (
                <button type="button" className={`sentence ${i === active ? 'active' : ''}`}
                  key={s.id} onClick={() => seek(s.start_sec)}
                  title="この文の先頭へ移動">
                  {s.text}
                </button>
              ))}
            </section>

            <section className="control-panel" aria-label="音声再生コントロール">
              <div className="control-head"><strong>感情カラー・タイムライン</strong><span>
                {story.emotion_mode === 'wrime_reader' && story.segments[active]?.reader_emotions
                  ? `現在の推定感情：${emotionNames[story.segments[active].primary_emotion ?? 'neutral'] ?? '不明'}（${Math.max(0, story.segments[active].reader_emotions?.[story.segments[active].primary_emotion ?? 'neutral'] ?? 0).toFixed(2)} / 3）`
                  : '文章をクリックして移動できます'}
              </span></div>
              <div className="gradient-track" style={{ backgroundImage: storyGradient(story) }}>
                <input aria-label="再生位置" type="range" min={0} max={story.duration_sec} step={0.05}
                  value={Math.min(time, story.duration_sec)} onChange={(e) => seek(Number(e.target.value))} />
              </div>
              <div className="time-row"><span>{labelTime(time)}</span><span>{labelTime(story.duration_sec)}</span></div>
              <div className="buttons">
                <button type="button" className="primary-button" onClick={togglePlayback}>
                  {playing ? '一時停止' : '再生'}
                </button>
                <button type="button" className="secondary-button" onClick={() => { seek(0); audioRef.current?.pause(); }}>先頭に戻る</button>
                <label className="speed">速度
                  <select value={speed} onChange={(e) => {
                    const next = Number(e.target.value);
                    setSpeed(next);
                    if (audioRef.current) audioRef.current.playbackRate = next;
                  }}>
                    {[0.75, 1, 1.25, 1.5].map((s) => <option value={s} key={s}>{s}×</option>)}
                  </select>
                </label>
              </div>
              <audio ref={audioRef} src={`${assetRoot}${story.audio_file}`} preload="metadata"
                onPlay={() => setPlaying(true)}
                onPause={() => { setPlaying(false); sync(true); }}
                onEnded={() => { setPlaying(false); sync(true); }}
                onSeeked={() => sync(true)}
                onLoadedMetadata={() => sync(true)}
                onError={() => setError('音声ファイルを読み込めません。narration.wav があるか確認してください。')} />
            </section>

            <footer className="footer">
              <p>朗読音声：{story.voice_name}（VOICEVOX）<br />
                <a href={story.source_url} target="_blank" rel="noreferrer">原文：青空文庫</a> ／ {story.source_credit}</p>
              <p>{story.emotion_mode === 'wrime_reader'
                ? '色は日本語BERT（WRIME）の推定結果に基づく試作表現です。SNSの書き手感情の推測を学習したモデルであり、文学作品の正解感情ではありません。'
                : 'これは音声と画面の同期を確認する試作版です。色は感情解析に基づくものではありません。'}</p>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
