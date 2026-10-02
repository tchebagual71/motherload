// UI fonts (UI-3; 03 §9.3, §10.5): the faces both looks name are shipped as Latin WOFF2 subsets within the
// 140 KB budget, declared with font-display: swap, and requested when the UI mounts.
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeApp } from '../../src/ui/fakes';
import { mountUI } from '../../src/ui/index';
import { flush, installFakeDom } from './ui-dom.helpers';

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/ui');
const css = readFileSync(resolve(UI_DIR, 'styles.css'), 'utf8');

interface Face {
  family: string;
  display: string;
  file: string;
}

function faces(): Face[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '',
    display: /font-display:\s*(\w+)/.exec(body)?.[1] ?? '',
    file: /src:\s*url\('([^']+)'\)\s*format\('woff2'\)/.exec(body)?.[1] ?? '',
  }));
}

/** First family of a custom property in a rule's block. */
function firstFamily(selector: string, prop: string): string {
  const block = css.slice(css.indexOf(`${selector} {`));
  const m = new RegExp(`${prop}:\\s*'([^']+)'`).exec(block.slice(0, block.indexOf('}')));
  return m?.[1] ?? '';
}

describe('UI fonts (UI-3)', () => {
  it('declares Fredoka, Nunito and Pixelify Sans as swap-displayed WOFF2 files that exist', () => {
    const all = faces();
    expect(all.map((f) => f.family).sort()).toEqual(['Fredoka', 'Nunito', 'Pixelify Sans']);
    let total = 0;
    for (const f of all) {
      expect(f.display).toBe('swap');
      const path = resolve(UI_DIR, f.file);
      const bytes = readFileSync(path);
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('wOF2');
      total += statSync(path).size;
    }
    expect(total).toBeLessThanOrEqual(140 * 1024); // 03 §10.5 budget
    expect(statSync(resolve(UI_DIR, 'fonts/OFL.txt')).size).toBeGreaterThan(0);
  });

  it('puts the shipped faces first in each look', () => {
    const shipped = new Set(faces().map((f) => f.family));
    expect(firstFamily('.hf-ui.hf-pixel', '--hf-font')).toBe('Pixelify Sans');
    expect(firstFamily('.hf-ui.hf-pixel', '--hf-font-digits')).toBe('Pixelify Sans');
    expect(firstFamily('.hf-ui.hf-pixel', '--hf-font-display')).toBe('Pixelify Sans');
    expect(firstFamily('\n.hf-ui', '--hf-font')).toBe('Nunito');
    expect(firstFamily('\n.hf-ui', '--hf-font-display')).toBe('Fredoka');
    for (const f of ['Pixelify Sans', 'Nunito', 'Fredoka']) expect(shipped.has(f)).toBe(true);
  });
});

describe('mountUI font loading', () => {
  let restore = () => {};
  afterEach(() => restore());

  it('starts every UI face downloading at mount', async () => {
    const dom = installFakeDom();
    restore = () => dom.restore();
    const asked: string[] = [];
    Object.assign(dom.document, { fonts: { load: (f: string) => (asked.push(f), Promise.resolve([])) } });
    const app = createFakeApp({ scope: 'm0', look: 'toon', overlay: 'title' });
    let unmount = () => {};
    await flush(() => (unmount = mountUI(dom.root as unknown as HTMLElement, app)));
    await flush(() => unmount());
    const families = asked.map((f) => /'([^']+)'/.exec(f)?.[1]);
    expect(families.sort()).toEqual(['Fredoka', 'Nunito', 'Pixelify Sans']);
  });
});
