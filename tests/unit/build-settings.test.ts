// Settings → Instant build (03 §4.3: "Instant build (setting) commits on lift"), rendered through Preact into the
// fake DOM (ui-dom.helpers.ts). Follow-up (a): the setting had a tray card but no row in Settings.
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { SettingsSheet } from '../../src/ui/sheets/SettingsSheet';
import { flush, installFakeDom, text, type FakeDom, type FakeElement } from './ui-dom.helpers';

let dom: FakeDom;
let app: FakeApp;

beforeEach(() => {
  dom = installFakeDom();
  app = createFakeApp({ scope: 'mvp', look: 'toon' });
});

afterEach(async () => {
  await flush(() => render(null, dom.root as unknown as HTMLElement));
  dom.restore();
});

const row = (label: string): FakeElement | undefined =>
  dom.root.querySelectorAll('[role="switch"]').find((el) => text(el.querySelector('.hf-row-label')) === label);

describe('Settings: Instant build', () => {
  it('shows an Instant build switch that turns Settings.instantBuild on and off', async () => {
    await flush(() => render(h(SettingsSheet, { app, close: () => undefined }), dom.root as unknown as HTMLElement));
    const sw = row('Instant build');
    expect(sw).toBeDefined();
    expect(sw!.getAttribute('aria-checked')).toBe('false');
    await flush(() => sw!.click());
    expect(app.state.settings.peek().instantBuild).toBe(true);
    expect(row('Instant build')!.getAttribute('aria-checked')).toBe('true');
    await flush(() => row('Instant build')!.click());
    expect(app.state.settings.peek().instantBuild).toBe(false);
  });
});
