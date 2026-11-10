import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import './App.css';

type View = 'experience' | 'analysis';
type Emotion = 'joy' | 'sadness' | 'anticipation' | 'surprise' | 'anger' | 'fear' | 'disgust' | 'trust';
type Segment = {
  id: string;
  text: string;
  start_sec: number;
  end_sec: number;
  reader_emotions: Record<string, number>;
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
const EMOTIONS: Emotion[] = ['joy', 'sadness', 'anticipation', 'surprise', 'anger', 'fear', 'disgust', 'trust'];
const LABELS: Record<Emotion, string> = {
  joy: '喜び', sadness: '悲しみ', anticipation: '期待', surprise: '驚き',
  anger: '怒り', fear: '恐れ', disgust: '嫌悪', trust: '信頼',
};
const COLORS: Record<Emotion, string> = {
  joy: '#E3B849', sadness: '#557FBE', anticipation: '#E59654', surprise: '#F0C66F',
  anger: '#CA5B61', fear: '#8262AF', disgust: '#819458', trust: '#44A798',
};
// Plutchik order: clockwise, starting at 12 o'clock.
const PLUTCHIK: Emotion[] = ['joy', 'trust', 'fear', 'surprise', 'sadness', 'disgust', 'anger', 'anticipation'];
const MESH_WIDTH = 320;
const MESH_HEIGHT = 180;
const SPREAD_SIGMA = 0.27; // spatial Gaussian sigma in normalized rectangle coordinates
const NEUTRAL_WEIGHT = 0.025; // same white contribution as the earlier spread comparison
const HEAT_WIDTH = 1200;
const HEAT_HEIGHT = 256;

const clamp = (x: number, min: number, max: number): number => Math.min(max, Math.max(min, x));
function clock(sec: number): string {
  const whole = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
function readableScores(segment: Segment): number[] {
  return EMOTIONS.map(e => clamp(Number(segment.reader_emotions[e]), 0, 3));
}
function indexAtTime(segments: Segment[], t: number): number {
  if (segments.length === 0) return -1;
  let lo = 0; let hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (segments[mid].start_sec <= t) lo = mid + 1; else hi = mid;
  }
  return clamp(lo - 1, 0, segments.length - 1);
}
function indexAtCenter(centers: number[], time: number): number {
  let lo = 0; let hi = centers.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (centers[mid] < time) lo = mid + 1; else hi = mid;
  }
  return lo;
}
function interpolatedScores(segments: Segment[], centers: number[], time: number): number[] {
  if (segments.length === 0) return Array(8).fill(0) as number[];
  if (time <= centers[0]) return readableScores(segments[0]);
  const last = segments.length - 1;
  if (time >= centers[last]) return readableScores(segments[last]);
  const after = indexAtCenter(centers, time);
  const before = after - 1;
  const span = centers[after] - centers[before];
  const ratio = span > 0 ? clamp((time - centers[before]) / span, 0, 1) : 1;
  const a = readableScores(segments[before]);
  const b = readableScores(segments[after]);
  return a.map((v, i) => v * (1 - ratio) + b[i] * ratio);
}
function dominantEmotion(segment: Segment): Emotion {
  let best = EMOTIONS[0]; let high = -Infinity;
  for (const emotion of EMOTIONS) {
    const value = Number(segment.reader_emotions[emotion]);
    if (value > high) { best = emotion; high = value; }
  }
  return best;
}

// OKLab conversion: the eight palette colors and white are mixed in OKLab space.
function srgbToLinear(c: number): number { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function toOK(hex: string): [number, number, number] {
  const c = [1, 3, 5].map(i => srgbToLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(.4122214708 * c[0] + .5363325363 * c[1] + .0514459929 * c[2]);
  const m = Math.cbrt(.2119034982 * c[0] + .6806995451 * c[1] + .1073969566 * c[2]);
  const s = Math.cbrt(.0883024619 * c[0] + .2817188376 * c[1] + .6299787005 * c[2]);
  return [.2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s];
}
function fromOK(L: number, a: number, b: number): [number, number, number] {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s,
  ];
  return linear.map(v => {
    const x = Math.max(0, v);
    return Math.round(255 * clamp(x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055, 0, 1));
  }) as [number, number, number];
}
const OK_PALETTE = EMOTIONS.map(e => toOK(COLORS[e]));
const OK_WHITE = toOK('#FFFFFF');
const RGB_PALETTE = EMOTIONS.map(e => ([1, 3, 5].map(i => parseInt(COLORS[e].slice(i, i + 2), 16))));

// Precompute fixed Gaussian weights; position never moves. Only scores vary with speech time.
let cachedKernel: Float32Array | undefined;
function getKernel(): Float32Array {
  if (cachedKernel) return cachedKernel;
  const k = new Float32Array(MESH_WIDTH * MESH_HEIGHT * 8);
  const centers = PLUTCHIK.map((e, i) => ({
    emotionIndex: EMOTIONS.indexOf(e),
    x: .5 + .335 * Math.sin(i * Math.PI / 4),
    y: .5 - .335 * Math.cos(i * Math.PI / 4),
  }));
  const denom = 2 * SPREAD_SIGMA * SPREAD_SIGMA;
  for (let y = 0; y < MESH_HEIGHT; y++) for (let x = 0; x < MESH_WIDTH; x++) {
    const px = (x + .5) / MESH_WIDTH;
    const py = (y + .5) / MESH_HEIGHT;
    for (const c of centers) {
      const dx = px - c.x; const dy = py - c.y;
      k[(y * MESH_WIDTH + x) * 8 + c.emotionIndex] = Math.exp(-(dx * dx + dy * dy) / denom);
    }
  }
  cachedKernel = k;
  return k;
}

const bufferCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
if (bufferCanvas) { bufferCanvas.width = MESH_WIDTH; bufferCanvas.height = MESH_HEIGHT; }
let meshImage: ImageData | null = null;
function renderMesh(canvas: HTMLCanvasElement, values: number[]): void {
  if (!bufferCanvas) return;
  const bufferContext = bufferCanvas.getContext('2d');
  const ctx = canvas.getContext('2d');
  if (!bufferContext || !ctx) return;
  if (!meshImage) meshImage = bufferContext.createImageData(MESH_WIDTH, MESH_HEIGHT);
  const data = meshImage.data;
  const kernel = getKernel();
  const scoreWeights = values.map(v => clamp(v, 0, 3) / 3);
  for (let pixel = 0; pixel < MESH_WIDTH * MESH_HEIGHT; pixel++) {
    const base = pixel * 8;
    let total = NEUTRAL_WEIGHT;
    let L = OK_WHITE[0] * NEUTRAL_WEIGHT;
    let a = OK_WHITE[1] * NEUTRAL_WEIGHT;
    let b = OK_WHITE[2] * NEUTRAL_WEIGHT;
    for (let e = 0; e < 8; e++) {
      const weight = kernel[base + e] * scoreWeights[e];
      total += weight;
      L += OK_PALETTE[e][0] * weight;
      a += OK_PALETTE[e][1] * weight;
      b += OK_PALETTE[e][2] * weight;
    }
    const [r, g, blue] = fromOK(L / total, a / total, b / total);
    const p = pixel * 4;
    data[p] = r; data[p + 1] = g; data[p + 2] = blue; data[p + 3] = 255;
  }
  bufferContext.putImageData(meshImage, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bufferCanvas, 0, 0, canvas.width, canvas.height);
}

function heatmapColor(emotionIndex: number, score: number): string {
  const a = clamp(score, 0, 3) / 3;
  return `rgb(${RGB_PALETTE[emotionIndex].map(channel => Math.round(255 * (1 - a) + channel * a)).join(',')})`;
}
function renderHeatmap(canvas: HTMLCanvasElement, story: Story): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const row = HEAT_HEIGHT / 8;
  for (const segment of story.segments) {
    const x = clamp(segment.start_sec / story.duration_sec * HEAT_WIDTH, 0, HEAT_WIDTH);
    const right = clamp(segment.end_sec / story.duration_sec * HEAT_WIDTH, x, HEAT_WIDTH);
    const scores = readableScores(segment);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = heatmapColor(i, scores[i]);
      ctx.fillRect(x, i * row, right - x + .3, row);
    }
  }
  ctx.strokeStyle = '#DDE3E8'; ctx.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    ctx.beginPath(); ctx.moveTo(0, i * row + .5); ctx.lineTo(HEAT_WIDTH, i * row + .5); ctx.stroke();
  }
}
function renderMaxTrack(canvas: HTMLCanvasElement, story: Story): void {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const segment of story.segments) {
    const left = clamp(segment.start_sec / story.duration_sec * canvas.width, 0, canvas.width);
    const right = clamp(segment.end_sec / story.duration_sec * canvas.width, left, canvas.width);
    ctx.fillStyle = COLORS[dominantEmotion(segment)];
    ctx.fillRect(left, 0, right - left + .3, canvas.height);
  }
}
function hashView(): View { return window.location.hash === '#analysis' ? 'analysis' : 'experience'; }

export default function App() {
  const [view, setView] = useState<View>(() => hashView());
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const meshRef = useRef<HTMLCanvasElement | null>(null);
  const heatmapRef = useRef<HTMLCanvasElement | null>(null);
  const maxRef = useRef<HTMLCanvasElement | null>(null);
  const lyricsRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const analysisLineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rafRef = useRef<number>(0);
  const lastUiRef = useRef(0);
  const lastGradientRef = useRef(0);
  const lastFollowRef = useRef<number | null>(null);
  const centers = useMemo(() => story?.segments.map(s => (s.start_sec + s.end_sec) / 2) ?? [], [story]);

  useEffect(() => {
    const listen = () => setView(hashView());
    window.addEventListener('hashchange', listen);
    return () => window.removeEventListener('hashchange', listen);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch(`${ASSET_ROOT}story.json`).then(async response => {
      if (!response.ok) throw new Error(`作品データの取得に失敗しました（HTTP ${response.status}）`);
      return await response.json() as Story;
    }).then(data => {
      if (cancelled) return;
      if (!data || !Array.isArray(data.segments) || !data.segments.length || !Number.isFinite(data.duration_sec) || data.duration_sec <= 0)
        throw new Error('作品データの形式が不正です。');
      for (const [i, s] of data.segments.entries()) {
        if (!s.reader_emotions || !EMOTIONS.every(e => Number.isFinite(Number(s.reader_emotions[e]))))
          throw new Error(`第${i + 1}文のReader感情スコアが不正です。`);
        if (!Number.isFinite(s.start_sec) || !Number.isFinite(s.end_sec) || s.end_sec < s.start_sec)
          throw new Error(`第${i + 1}文の朗読時刻が不正です。`);
      }
      setStory(data);
    }).catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, []);

  const paint = useCallback((now: number) => {
    if (!story || !meshRef.current) return;
    renderMesh(meshRef.current, interpolatedScores(story.segments, centers, now));
  }, [story, centers]);
  const sync = useCallback((force = false) => {
    if (!story || !audioRef.current) return;
    const now = audioRef.current.currentTime;
    const stamp = performance.now();
    if (force || stamp - lastGradientRef.current > 110) {
      paint(now); lastGradientRef.current = stamp;
    }
    if (force || stamp - lastUiRef.current > 90) {
      setTime(now);
      setActive(indexAtTime(story.segments, now));
      lastUiRef.current = stamp;
    }
  }, [story, paint]);
  useEffect(() => {
    if (!playing) return;
    const tick = () => { sync(); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, sync]);
  useEffect(() => { if (story) { paint(audioRef.current?.currentTime ?? 0); sync(true); } }, [story, view, paint, sync]);
  useEffect(() => {
    if (view !== 'analysis' || !story) return;
    if (heatmapRef.current) renderHeatmap(heatmapRef.current, story);
    if (maxRef.current) renderMaxTrack(maxRef.current, story);
  }, [story, view]);
  useEffect(() => {
    if (view !== 'experience' || !story || !lyricsRef.current) return;
    const scroller = lyricsRef.current;
    const line = lineRefs.current[active];
    if (!line) return;
    const lineRect = line.getBoundingClientRect();
    const boxRect = scroller.getBoundingClientRect();
    const top = scroller.scrollTop + lineRect.top - boxRect.top - (scroller.clientHeight - lineRect.height) / 2;
    const jump = lastFollowRef.current === null || Math.abs(active - lastFollowRef.current) > 2;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({ top: Math.max(0, top), behavior: jump || reduce ? 'instant' : 'smooth' });
    lastFollowRef.current = active;
  }, [active, story, view]);

  const switchView = (next: View) => {
    setView(next);
    window.location.hash = next;
    if (next === 'experience') lastFollowRef.current = null;
  };
  const seek = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !story) return;
    const duration = Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.min(story.duration_sec, audio.duration) : story.duration_sec;
    audio.currentTime = clamp(seconds, 0, duration);
    sync(true);
  };
  const toggle = async () => {
    const audio = audioRef.current; if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try { await audio.play(); setError(''); }
    catch (reason: unknown) { setError(`音声を再生できません：${String(reason)}`); }
  };
  const activeSegment = story?.segments[active];
  const displayScores = activeSegment ? readableScores(activeSegment) : Array(8).fill(0) as number[];
  const maxEmotion = activeSegment ? dominantEmotion(activeSegment) : EMOTIONS[0];
  const progress = story ? clamp(time / story.duration_sec * 100, 0, 100) : 0;
  const seekFromPointer = (event: MouseEvent<HTMLDivElement>) => {
    if (!story) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seek((event.clientX - rect.left) / rect.width * story.duration_sec);
  };
  const seekFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!story) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); seek(time + 5); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); seek(time - 5); }
  };

  return (
    <div className={`es-app ${view === 'experience' ? 'es-app-experience' : 'es-app-analysis'}`}>
      <header className="es-header">
        <div className="es-brand">
          <span className="es-brand-mark" aria-hidden="true">◉</span>
          <span>STORYCHROMA</span>
          <span className="es-brand-subtitle">{story ? `${story.title} · ${story.author}` : 'Interactive audiobook'}</span>
        </div>
        <nav className="es-switch" aria-label="表示モード切り替え">
          <button type="button" className={view === 'experience' ? 'is-selected' : ''}
            aria-current={view === 'experience' ? 'page' : undefined} onClick={() => switchView('experience')}>
            Experience <span>鑑賞</span>
          </button>
          <button type="button" className={view === 'analysis' ? 'is-selected' : ''}
            aria-current={view === 'analysis' ? 'page' : undefined} onClick={() => switchView('analysis')}>
            Analysis <span>分析</span>
          </button>
        </nav>
      </header>
      {error && <div className="es-error" role="alert">{error}</div>}
      {!story ? <main className="es-loading">作品データを読み込んでいます。<br />読み込めない場合はPythonで生成したstory.jsonの配置を確認してください。</main> : (
        <>
          {view === 'experience' ? (
            <main className="es-experience" aria-label="鑑賞画面">
              <canvas ref={meshRef} className="es-full-gradient" width="960" height="540" aria-hidden="true" />
              <div className="es-gradient-dimmer" aria-hidden="true" />
              <div className="es-lyrics" ref={lyricsRef} aria-label="朗読中の文章">
                <div className="es-lyrics-stack">
                  {story.segments.map((segment, i) => {
                    const distance = Math.abs(i - active);
                    return (
                      <button type="button" key={segment.id} ref={node => { lineRefs.current[i] = node; }}
                        className={`es-lyric ${i === active ? 'is-active' : ''} ${distance === 1 ? 'is-near' : ''}`}
                        aria-current={i === active ? 'true' : undefined}
                        onClick={() => seek(segment.start_sec)} title={`第${i + 1}文へ移動`}>
                        {segment.text}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="es-experience-counter">{String(active + 1).padStart(3, '0')} / {story.segments.length}</div>
            </main>
          ) : (
            <main className="es-analysis" aria-label="分析画面">
              <div className="es-analysis-intro">
                <div><div className="es-kicker">EMOTION ANALYSIS</div><h1>{story.title}</h1><p>{story.author} — {story.segments.length}文 · {clock(story.duration_sec)}</p></div>
                <span className="es-analysis-flag">Japanese BERT / WRIME Reader</span>
              </div>
              <div className="es-analysis-grid">
                <section className="es-panel es-bars-panel" aria-labelledby="es-bars-title">
                  <div className="es-panel-heading"><div><span className="es-panel-number">01</span><h2 id="es-bars-title">感情スコア（8種類）</h2></div><span>WRIME 0–3</span></div>
                  <div className="es-bars">
                    {EMOTIONS.map((emotion, i) => {
                      const raw = Number(activeSegment?.reader_emotions[emotion]);
                      return <div className="es-bar-row" key={emotion}>
                        <span className="es-emotion-label">{LABELS[emotion]}</span>
                        <div className="es-bar-track"><div className="es-bar-fill" style={{ width: `${displayScores[i] / 3 * 100}%`, backgroundColor: COLORS[emotion] }} /></div>
                        <span className="es-bar-number">{raw.toFixed(2)}</span>
                      </div>;
                    })}
                  </div>
                  <div className="es-bar-scale"><span>0</span><span>1</span><span>2</span><span>3</span></div>
                  <p className="es-caption">8感情は共通の0〜3尺度。元の回帰値を数値表示し、範囲外の値は棒の表示のみ制限します。</p>
                </section>
                <section className="es-panel es-mesh-panel" aria-labelledby="es-mesh-title">
                  <div className="es-panel-heading"><div><span className="es-panel-number">04</span><h2 id="es-mesh-title">多色グラデーション</h2></div><span>8感情 · OKLab</span></div>
                  <div className="es-mesh-wrap"><canvas ref={meshRef} className="es-analysis-mesh" width="960" height="540" aria-label="現在時刻の8次元Multi-point Gradient" /></div>
                  <p className="es-caption">8感情の色を同じ画面内で混合するMulti-point Gradient。Plutchik順・円周等間隔・空間σ=0.27。色の位置は固定し、朗読に合わせて強度を連続補間します。</p>
                </section>
                <section className="es-panel es-wide-panel" aria-labelledby="es-heat-title">
                  <div className="es-panel-heading"><div><span className="es-panel-number">02</span><h2 id="es-heat-title">感情ヒートマップ（物語全体）</h2></div><span>朗読時間 × 8感情</span></div>
                  <div className="es-heatmap">
                    <div className="es-heatmap-labels">{EMOTIONS.map(e => <span key={e}>{LABELS[e]}</span>)}</div>
                    <div className="es-heatmap-visual" role="button" tabIndex={0} aria-label="ヒートマップをクリックしてシーク（左右矢印キーで5秒移動）" onClick={seekFromPointer} onKeyDown={seekFromKeyboard}>
                      <canvas ref={heatmapRef} width={HEAT_WIDTH} height={HEAT_HEIGHT} aria-hidden="true" />
                      <div className="es-timeline-cursor" style={{ left: `${progress}%` }} aria-hidden="true" />
                    </div>
                  </div>
                  <div className="es-axis-times"><span>0:00</span><span>{clock(story.duration_sec)}</span></div>
                  <p className="es-caption">横軸は朗読時刻。白（0）から各感情色（3）へRGB線形変化。文ごとに一定値を表示し、時間平滑化は行いません。</p>
                </section>
                <section className="es-panel es-wide-panel" aria-labelledby="es-max-title">
                  <div className="es-panel-heading"><div><span className="es-panel-number">03</span><h2 id="es-max-title">主要感情のタイムライン</h2></div><span>文単位 · 補間なし</span></div>
                  <div className="es-max-visual" role="button" tabIndex={0} aria-label="最大感情色帯をクリックしてシーク（左右矢印キーで5秒移動）" onClick={seekFromPointer} onKeyDown={seekFromKeyboard}>
                    <canvas ref={maxRef} width="1200" height="48" aria-hidden="true" />
                    <div className="es-timeline-cursor" style={{ left: `${progress}%` }} aria-hidden="true" />
                  </div>
                  <div className="es-axis-times"><span>0:00</span><span>{clock(story.duration_sec)}</span></div>
                  <p className="es-caption">現在の最大感情：<strong>{LABELS[maxEmotion]}</strong>。弱い推定値でも必ず1つの感情を選ぶ、比較用の要約表示です。</p>
                </section>
                <section className="es-panel es-wide-panel es-transcript-panel" aria-labelledby="es-transcript-title">
                  <div className="es-panel-heading">
                    <div><span className="es-panel-number">05</span><h2 id="es-transcript-title">物語の本文（全文）</h2></div>
                    <span>{story.segments.length}文</span>
                  </div>
                  <div className="es-transcript-toolbar">
                    <p>朗読中の文を強調表示します。文章をクリックすると、その文の先頭から再生できます。</p>
                    <button type="button" className="es-jump-current" onClick={() => analysisLineRefs.current[active]?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' })}>
                      現在の文へ移動
                    </button>
                  </div>
                  <div className="es-transcript" aria-label="ごん狐の全文テキスト">
                    {story.segments.map((segment, i) => (
                      <button type="button" key={segment.id} ref={node => { analysisLineRefs.current[i] = node; }}
                        className={`es-transcript-sentence ${i === active ? 'is-active' : ''}`}
                        aria-current={i === active ? 'true' : undefined}
                        onClick={() => seek(segment.start_sec)} title={`第${i + 1}文から再生`}>
                        {segment.text}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
              <footer className="es-footer">
                <p>朗読：VOICEVOX:ずんだもん（あまあま） · <a href={story.source_url} target="_blank" rel="noreferrer">原文：青空文庫</a> · {story.source_credit}</p>
                <p>WRIME Reader側はSNS投稿の書き手感情について読み手が推測した強度に基づきます。物語の客観的な感情や鑑賞者自身の感情を測定したものではありません。色と配置はStoryChroma独自の可視化規則です。</p>
              </footer>
            </main>
          )}
          <div className="es-player" aria-label="共通の朗読プレーヤー">
            <div className="es-player-row">
              <div className="es-transport">
                <button type="button" className="es-play-button" onClick={toggle} aria-label={playing ? '一時停止' : '再生'}>{playing ? 'Ⅱ' : '▶'}</button>
                <div className="es-player-title"><strong>{story.title}</strong><span>{active + 1} / {story.segments.length}文</span></div>
                <button type="button" className="es-small-button" onClick={() => seek(story.segments[Math.max(0, active - 1)].start_sec)} aria-label="前の文">⏮</button>
                <button type="button" className="es-small-button" onClick={() => seek(story.segments[Math.min(story.segments.length - 1, active + 1)].start_sec)} aria-label="次の文">⏭</button>
              </div>
              <div className="es-seek-control">
                <span>{clock(time)}</span>
                <input type="range" min={0} max={story.duration_sec} step={0.05} value={clamp(time, 0, story.duration_sec)} onChange={event => seek(Number(event.target.value))} aria-label="再生位置" />
                <span>{clock(story.duration_sec)}</span>
              </div>
              <label className="es-speed">速度 <select value={speed} onChange={event => {
                const next = Number(event.target.value); setSpeed(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }}>{[0.75, 1, 1.25, 1.5].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
            </div>
            <div className="es-player-credit" aria-label="作品と音声のクレジット">
              <span>朗読：VOICEVOX:ずんだもん（あまあま）</span>
              <a href={story.source_url} target="_blank" rel="noreferrer">原文：青空文庫</a>
            </div>
          </div>
        </>
      )}
      <audio ref={audioRef} src={story ? `${ASSET_ROOT}${encodeURIComponent(story.audio_file)}` : undefined} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); sync(true); }}
        onEnded={() => { setPlaying(false); sync(true); }} onTimeUpdate={() => sync(true)} onSeeked={() => sync(true)}
        onLoadedMetadata={() => { if (audioRef.current) audioRef.current.playbackRate = speed; sync(true); }}
        onError={() => { if (story) setError(`音声ファイルを読み込めません：${story.audio_file}`); }} />
    </div>
  );
}
