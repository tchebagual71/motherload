// Perf HUD (settings.showPerf; 04 §10): fps, frame ms, draw calls, triangles.
import type { JSX } from 'preact';
import type { AppController } from '../../app/types';

export function PerfHud({ app }: { app: AppController }): JSX.Element | null {
  const p = app.state.perf.value;
  if (!p) return null;
  const tris = p.tris >= 1000 ? `${Math.round(p.tris / 1000)}k` : String(p.tris);
  return (
    <div class="hf-perf" aria-hidden="true">
      <span>{Math.round(p.fps)} fps</span>
      <span>{p.frameMs.toFixed(1)} ms</span>
      <span>{p.drawCalls} dc</span>
      <span>{tris} tri</span>
    </div>
  );
}
