import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as pdfjsLib from 'pdfjs-dist';
import type { CanvasNode } from '../../../../../src/core/canvas-model';
import { useCanvasStore } from '../../stores/canvas-store';
import { ExperimentLogBody } from '../nodes/ExperimentLogBody';
import { TaskBody } from '../nodes/TaskBody';

// ── Icon helper ──────────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, string> = {
  paper: '📄', note: '📝', code: '💻', image: '🖼️',
  ai_output: '🤖', audio: '🎵', video: '🎬',
  experiment_log: '🧪', task: '✅', data: '📊',
};

// ── Main PreviewModal ────────────────────────────────────────────────────────

export function PreviewModal() {
  const previewNodeId = useCanvasStore(s => s.previewNodeId);
  const closePreview = useCanvasStore(s => s.closePreview);
  const nodes = useCanvasStore(s => s.nodes);
  const imageUriMap = useCanvasStore(s => s.imageUriMap);
  const fullContentCache = useCanvasStore(s => s.fullContentCache);

  // ESC to close
  useEffect(() => {
    if (!previewNodeId) { return; }
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closePreview(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewNodeId, closePreview]);

  if (!previewNodeId) { return null; }

  const flowNode = nodes.find(n => n.id === previewNodeId);
  if (!flowNode) { return null; }
  const node = flowNode.data as CanvasNode;
  const fullContent = fullContentCache[previewNodeId];
  const displayContent = fullContent ?? node.meta?.content_preview;
  const uri = node.file_path ? imageUriMap[node.file_path] : undefined;
  const icon = NODE_ICONS[node.node_type] ?? '📁';

  return ReactDOM.createPortal(
    <div
      onClick={closePreview}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 99998,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '85vw', height: '85vh',
          maxWidth: 1200,
          background: 'var(--vscode-editor-background)',
          borderRadius: 10,
          border: '1px solid var(--vscode-panel-border)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 16px',
          borderBottom: '1px solid var(--vscode-panel-border)',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 18 }}>{icon}</span>
          <span style={{
            flex: 1, fontSize: 14, fontWeight: 600,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'var(--vscode-foreground)',
          }}>
            {node.title || '无标题'}
          </span>
          {node.file_path && (
            <span style={{
              fontSize: 11, color: 'var(--vscode-descriptionForeground)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              maxWidth: '40%',
            }}>
              {node.file_path}
            </span>
          )}
          <button
            onClick={closePreview}
            style={{
              background: 'none', border: 'none',
              color: 'var(--vscode-foreground)',
              fontSize: 20, cursor: 'pointer',
              padding: '0 4px', lineHeight: 1, flexShrink: 0,
            }}
            title="关闭 (ESC)"
          >
            ×
          </button>
        </div>

        {/* ── Content ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflow: 'auto', padding: 0, minHeight: 0 }}>
          <PreviewContent
            node={node}
            displayContent={displayContent as string | undefined}
            uri={uri}
            imageUriMap={imageUriMap}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Content dispatcher ───────────────────────────────────────────────────────

function PreviewContent({
  node, displayContent, uri, imageUriMap,
}: {
  node: CanvasNode;
  displayContent: string | undefined;
  uri: string | undefined;
  imageUriMap: Record<string, string>;
}) {
  switch (node.node_type) {
    case 'paper':
      return <FullPdfPreview uri={uri} />;
    case 'image':
      return <FullImagePreview uri={uri} title={node.title} />;
    case 'audio':
      return <FullAudioPreview uri={uri} />;
    case 'video':
      return <FullVideoPreview uri={uri} />;
    case 'code':
      return displayContent
        ? <FullCodePreview source={displayContent} filePath={node.file_path} />
        : <EmptyHint />;
    case 'note':
    case 'ai_output':
      return displayContent
        ? <FullMarkdownPreview source={displayContent} />
        : <EmptyHint />;
    case 'data':
      return displayContent
        ? <FullTablePreview source={displayContent} />
        : <EmptyHint />;
    case 'experiment_log':
      return (
        <div style={{ padding: 20 }}>
          <ExperimentLogBody node={node} />
        </div>
      );
    case 'task':
      return (
        <div style={{ padding: 20 }}>
          <TaskBody node={node} />
        </div>
      );
    default:
      return displayContent
        ? <FullMarkdownPreview source={displayContent} />
        : <EmptyHint />;
  }
}

function EmptyHint() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', color: 'var(--vscode-descriptionForeground)', fontSize: 14,
    }}>
      暂无内容
    </div>
  );
}

// ── Full Markdown Preview ────────────────────────────────────────────────────

function FullMarkdownPreview({ source }: { source: string }) {
  return (
    <div style={{ padding: '20px 32px', fontSize: 14, lineHeight: 1.7, color: 'var(--vscode-editor-foreground)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={{ fontSize: 24, fontWeight: 700, margin: '16px 0 8px', borderBottom: '1px solid var(--vscode-panel-border)', paddingBottom: 6 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ fontSize: 20, fontWeight: 600, margin: '14px 0 6px' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ fontSize: 17, fontWeight: 600, margin: '12px 0 4px' }}>{children}</h3>,
          h4: ({ children }) => <h4 style={{ fontSize: 15, fontWeight: 600, margin: '10px 0 4px' }}>{children}</h4>,
          h5: ({ children }) => <h5 style={{ fontSize: 14, fontWeight: 600, margin: '8px 0 2px' }}>{children}</h5>,
          h6: ({ children }) => <h6 style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 2px', color: 'var(--vscode-descriptionForeground)' }}>{children}</h6>,
          p: ({ children }) => <p style={{ margin: '6px 0' }}>{children}</p>,
          ul: ({ children }) => <ul style={{ paddingLeft: 24, margin: '4px 0' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ paddingLeft: 24, margin: '4px 0' }}>{children}</ol>,
          li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code style={{
                  display: 'block',
                  fontFamily: 'var(--vscode-editor-font-family, "Fira Code", monospace)',
                  fontSize: 13, lineHeight: 1.5,
                }}>
                  {children}
                </code>
              );
            }
            return (
              <code style={{
                fontFamily: 'var(--vscode-editor-font-family, "Fira Code", monospace)',
                fontSize: 13, background: 'rgba(255,255,255,0.08)',
                padding: '1px 4px', borderRadius: 3,
              }}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre style={{
              background: 'rgba(0,0,0,0.25)', padding: '12px 16px',
              borderRadius: 6, overflow: 'auto', margin: '8px 0',
              fontFamily: 'var(--vscode-editor-font-family, "Fira Code", monospace)',
              fontSize: 13, lineHeight: 1.5,
            }}>
              {children}
            </pre>
          ),
          a: ({ href, children }) => (
            <a href={href} style={{ color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline' }} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote style={{
              borderLeft: '3px solid var(--vscode-panel-border)', paddingLeft: 14,
              margin: '8px 0', color: 'var(--vscode-descriptionForeground)',
            }}>
              {children}
            </blockquote>
          ),
          hr: () => <hr style={{ border: 'none', borderTop: '1px solid var(--vscode-panel-border)', margin: '12px 0' }} />,
          table: ({ children }) => (
            <table style={{
              borderCollapse: 'collapse', width: '100%', margin: '8px 0',
              fontSize: 13,
            }}>
              {children}
            </table>
          ),
          th: ({ children }) => (
            <th style={{
              padding: '6px 10px', fontWeight: 600, textAlign: 'left',
              borderBottom: '2px solid var(--vscode-panel-border)',
              background: 'var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.06))',
            }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td style={{
              padding: '4px 10px',
              borderBottom: '1px solid var(--vscode-panel-border)',
            }}>
              {children}
            </td>
          ),
          img: ({ src, alt }) => (
            <img src={src} alt={alt ?? ''} style={{ maxWidth: '100%', borderRadius: 6, margin: '8px 0' }} />
          ),
          strong: ({ children }) => <strong>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// ── Full Code Preview ────────────────────────────────────────────────────────

function fileExtToLang(filePath?: string): string {
  if (!filePath) { return ''; }
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    py: 'python', js: 'javascript', ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
    rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
    cs: 'csharp', rb: 'ruby', sh: 'bash', zsh: 'bash', fish: 'bash',
    html: 'html', css: 'css', scss: 'scss', json: 'json', yaml: 'yaml',
    yml: 'yaml', toml: 'toml', xml: 'xml', sql: 'sql', swift: 'swift',
    kt: 'kotlin', lua: 'lua', r: 'r', m: 'matlab', php: 'php',
  };
  return map[ext] ?? ext;
}

function FullCodePreview({ source, filePath }: { source: string; filePath?: string }) {
  const lang = fileExtToLang(filePath);
  const lines = source.split('\n');
  const gutterWidth = Math.max(32, String(lines.length).length * 10 + 16);

  return (
    <div style={{
      background: 'rgba(0,0,0,0.25)', padding: 0, height: '100%', overflow: 'auto',
      fontFamily: 'var(--vscode-editor-font-family, "Fira Code", "Consolas", monospace)',
      fontSize: 13, lineHeight: 1.6,
    }}>
      {lang && (
        <div style={{
          padding: '6px 16px', fontSize: 11,
          color: 'var(--vscode-descriptionForeground)', opacity: 0.7,
          borderBottom: '1px solid var(--vscode-panel-border)',
          fontFamily: 'var(--vscode-font-family, sans-serif)',
        }}>
          {lang}
        </div>
      )}
      <div style={{ padding: '8px 0' }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', whiteSpace: 'pre', minHeight: 20 }}>
            <span style={{
              display: 'inline-block', width: gutterWidth,
              textAlign: 'right', paddingRight: 12,
              color: 'var(--vscode-editorLineNumber-foreground, rgba(255,255,255,0.25))',
              flexShrink: 0, userSelect: 'none',
            }}>
              {i + 1}
            </span>
            <span style={{ color: 'var(--vscode-editor-foreground)', paddingRight: 16 }}>
              {line || ' '}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Full PDF Preview (multi-page) ────────────────────────────────────────────

function FullPdfPreview({ uri }: { uri: string | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uri) { return; }
    let cancelled = false;
    let pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;

    (async () => {
      try {
        pdfDoc = await pdfjsLib.getDocument({ url: uri, cMapUrl: undefined, cMapPacked: true }).promise;
        if (cancelled) { pdfDoc.destroy(); return; }
        setNumPages(pdfDoc.numPages);

        const container = containerRef.current;
        if (!container || cancelled) { pdfDoc.destroy(); return; }

        // Clear previous canvases
        container.innerHTML = '';

        const dpr = window.devicePixelRatio || 1;
        const scale = 1.5;

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) { break; }
          const page = await pdfDoc.getPage(i);
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width * dpr;
          canvas.height = viewport.height * dpr;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
          canvas.style.marginBottom = '8px';
          canvas.style.borderRadius = '4px';
          canvas.style.boxShadow = '0 1px 4px rgba(0,0,0,0.2)';

          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.scale(dpr, dpr);
            await page.render({ canvasContext: ctx, viewport }).promise;
          }

          if (!cancelled) {
            container.appendChild(canvas);
          }
        }

        if (!cancelled) { setLoading(false); }
        pdfDoc.destroy();
        pdfDoc = null;
      } catch (e) {
        console.error('[RS] FullPdfPreview error:', e);
        if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
      if (pdfDoc) { pdfDoc.destroy(); }
    };
  }, [uri]);

  if (!uri) {
    return <EmptyHint />;
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--vscode-errorForeground)', fontSize: 14 }}>
        PDF 渲染失败
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {numPages > 0 && (
        <div style={{
          padding: '6px 16px', fontSize: 12,
          color: 'var(--vscode-descriptionForeground)',
          borderBottom: '1px solid var(--vscode-panel-border)',
          flexShrink: 0,
        }}>
          共 {numPages} 页
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          flex: 1, overflow: 'auto', padding: 16,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
      >
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, color: 'var(--vscode-descriptionForeground)' }}>
            渲染中…
          </div>
        )}
      </div>
    </div>
  );
}

// ── Full Image Preview ───────────────────────────────────────────────────────

function FullImagePreview({ uri, title }: { uri: string | undefined; title: string }) {
  const [error, setError] = useState(false);

  if (!uri) { return <EmptyHint />; }
  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--vscode-errorForeground)', fontSize: 14 }}>
        图像加载失败
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 16, background: 'rgba(0,0,0,0.1)',
    }}>
      <img
        src={uri}
        alt={title}
        onError={() => setError(true)}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4 }}
      />
    </div>
  );
}

// ── Full Audio Preview (waveform + playback) ─────────────────────────────────

/** Downsample audio buffer to N bars for waveform rendering */
function extractWaveform(audioBuffer: AudioBuffer, bars: number): number[] {
  const raw = audioBuffer.getChannelData(0);
  const blockSize = Math.floor(raw.length / bars);
  const result: number[] = [];
  for (let i = 0; i < bars; i++) {
    let sum = 0;
    const start = i * blockSize;
    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(raw[start + j]);
    }
    result.push(sum / blockSize);
  }
  const max = Math.max(...result, 0.001);
  return result.map(v => v / max);
}

function FullAudioPreview({ uri }: { uri: string | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const animRef = useRef<number>(0);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const BARS = 80;

  // Decode waveform
  useEffect(() => {
    if (!uri) { return; }
    let cancelled = false;

    (async () => {
      let ctx: AudioContext | null = null;
      try {
        const res = await fetch(uri);
        if (!res.ok) { throw new Error('fetch failed'); }
        const buf = await res.arrayBuffer();
        ctx = new AudioContext();
        const decoded = await ctx.decodeAudioData(buf);
        if (!cancelled) {
          setWaveform(extractWaveform(decoded, BARS));
          if (decoded.duration && isFinite(decoded.duration)) { setDuration(decoded.duration); }
        }
      } catch {
        // Fallback bars
        if (!cancelled) {
          let seed = 0;
          for (let i = 0; i < uri.length; i++) { seed = ((seed << 5) - seed + uri.charCodeAt(i)) | 0; }
          const fake: number[] = [];
          for (let i = 0; i < BARS; i++) {
            seed = (seed * 16807 + 0) % 2147483647;
            fake.push(0.15 + (seed / 2147483647) * 0.7);
          }
          setWaveform(fake);
        }
      } finally {
        ctx?.close();
      }
    })();

    return () => { cancelled = true; };
  }, [uri]);

  // Get duration from audio element
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !uri) { return; }
    audio.src = uri;
    const onMeta = () => {
      if (audio.duration && isFinite(audio.duration)) { setDuration(audio.duration); }
    };
    audio.addEventListener('loadedmetadata', onMeta);
    return () => audio.removeEventListener('loadedmetadata', onMeta);
  }, [uri]);

  // Draw waveform
  const drawWaveformCb = useCallback(() => {
    const cvs = canvasRef.current;
    if (!cvs || !waveform) { return; }
    const ctx = cvs.getContext('2d');
    if (!ctx) { return; }
    const dpr = window.devicePixelRatio || 1;
    const w = cvs.clientWidth;
    const h = cvs.clientHeight;
    cvs.width = w * dpr;
    cvs.height = h * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, w, h);
    const barW = Math.max(2, (w / waveform.length) * 0.65);
    const gap = w / waveform.length;
    const mid = h / 2;

    for (let i = 0; i < waveform.length; i++) {
      const x = i * gap + (gap - barW) / 2;
      const barH = Math.max(3, waveform[i] * (h - 8));
      ctx.fillStyle = (i / waveform.length) < progress
        ? 'rgba(100,160,255,0.9)'
        : 'rgba(100,160,255,0.35)';
      ctx.beginPath();
      ctx.roundRect(x, mid - barH / 2, barW, barH, barW / 2);
      ctx.fill();
    }
  }, [waveform, progress]);

  useEffect(() => { drawWaveformCb(); }, [drawWaveformCb]);

  // Animation loop for progress
  useEffect(() => {
    if (!playing) { return; }
    const tick = () => {
      const audio = audioRef.current;
      if (audio && audio.duration) {
        setProgress(audio.currentTime / audio.duration);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [playing]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) { return; }
    if (audio.paused) {
      audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const audio = audioRef.current;
    const cvs = canvasRef.current;
    if (!audio || !cvs || !duration) { return; }
    const rect = cvs.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    audio.currentTime = ratio * duration;
    setProgress(ratio);
  }, [duration]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!uri) { return <EmptyHint />; }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: '40px 32px', gap: 20,
    }}>
      <audio
        ref={audioRef}
        onEnded={() => { setPlaying(false); setProgress(0); }}
        style={{ display: 'none' }}
      />

      {/* Waveform */}
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        style={{ width: '100%', maxWidth: 800, height: 120, cursor: 'pointer', borderRadius: 6 }}
      />

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button
          onClick={togglePlay}
          style={{
            width: 48, height: 48, borderRadius: '50%',
            background: 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            border: 'none', cursor: 'pointer',
            fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title={playing ? '暂停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span style={{ fontSize: 14, color: 'var(--vscode-descriptionForeground)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(progress * duration)} / {fmt(duration)}
        </span>
      </div>
    </div>
  );
}

// ── Full Video Preview ───────────────────────────────────────────────────────

function FullVideoPreview({ uri }: { uri: string | undefined }) {
  if (!uri) { return <EmptyHint />; }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', padding: 16, background: '#000',
    }}>
      <video
        src={uri}
        controls
        autoPlay={false}
        style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 4 }}
      />
    </div>
  );
}

// ── Full Table Preview ───────────────────────────────────────────────────────

function FullTablePreview({ source }: { source: string }) {
  const delimiter = source.includes('\t') ? '\t' : ',';
  const lines = source.split(/\r?\n/).filter(l => l.trim());
  const rows = lines.map(line => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === delimiter && !inQuotes) { cells.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    cells.push(current.trim());
    return cells;
  });

  if (rows.length === 0) { return <EmptyHint />; }

  const header = rows[0];
  const body = rows.slice(1);

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }}>
      <div style={{
        fontSize: 12, color: 'var(--vscode-descriptionForeground)',
        marginBottom: 8,
      }}>
        {header.length} 列 × {body.length} 行
      </div>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: 13,
        border: '1px solid var(--vscode-panel-border)', borderRadius: 6,
      }}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={{
                padding: '6px 10px', fontWeight: 600, textAlign: 'left',
                background: 'var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.06))',
                borderBottom: '2px solid var(--vscode-panel-border)',
                borderRight: i < header.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                whiteSpace: 'nowrap',
              }}>
                {h || `Col ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} style={{
              background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
            }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '4px 10px',
                  borderBottom: '1px solid var(--vscode-panel-border)',
                  borderRight: ci < row.length - 1 ? '1px solid var(--vscode-panel-border)' : 'none',
                  color: 'var(--vscode-foreground)',
                }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
