// Radio voice blips follow the card on show (03 §6.5, §11.5; INT-4): each full card speaks as it opens or advances
// (never a ticker, never a message waiting under build mode); a covering sheet, the last card's end and build mode
// stop the blips; the radio's state outlives the story layer, so build mode never restarts a message at card 1.
import { h, render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RadioMessage } from '../../src/app/types';
import { createFakeApp, type FakeApp } from '../../src/ui/fakes';
import { StoryLayer } from '../../src/ui/story/StoryLayer';
import { flush, installFakeDom, text, type FakeDom } from './ui-dom.helpers';

const msg = (id: number, cards: string[]): RadioMessage => ({ id, beat: 'S1', sender: 'Dot', cards, at: 0 });

let dom: FakeDom;
let app: FakeApp;
let now = 0;

beforeEach(() => {
  dom = installFakeDom();
  app = createFakeApp({ scope: 'mvp', look: 'toon', styleTest: false });
  now = 1_000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(app, 'speakRadio');
  vi.spyOn(app, 'stopRadioSpeech');
});

afterEach(async () => {
  await flush(() => render(null, dom.root as unknown as HTMLElement));
  vi.restoreAllMocks();
  dom.restore();
});

const mount = () => flush(() => render(h(StoryLayer, { app }), dom.root as unknown as HTMLElement));
const unmount = () => flush(() => render(null, dom.root as unknown as HTMLElement));
const tick = (ms: number) =>
  flush(() => {
    now += ms;
    app.state.hudTick.value++;
  });
const next = () => dom.root.querySelector('.hf-radio-next')!;

describe('radio voice blips (INT-4)', () => {
  it('speak each card as it opens (not the ticker); › moves the voice on; the last card stops it', async () => {
    app.state.radio.value = [msg(7, ['First card.', 'Second card.'])];
    await mount();
    expect(dom.root.querySelector('.hf-radio-ticker')).not.toBeNull();
    expect(app.speakRadio).not.toHaveBeenCalled();
    await tick(700); // grounded and idle: the full card opens
    expect(app.speakRadio).toHaveBeenCalledTimes(1);
    expect(app.speakRadio).toHaveBeenLastCalledWith('Dot', 'First card.');
    await tick(100); // still the same card: not spoken again
    expect(app.speakRadio).toHaveBeenCalledTimes(1);
    await flush(() => next().click());
    expect(app.speakRadio).toHaveBeenLastCalledWith('Dot', 'Second card.');
    expect(app.stopRadioSpeech).not.toHaveBeenCalled();
    await flush(() => next().click());
    await tick(100);
    expect(app.stopRadioSpeech).toHaveBeenCalledTimes(1);
    expect(app.state.radio.value).toEqual([]);
  });

  it('a covering sheet stops the blips; the card speaks again when it shows again', async () => {
    app.state.radio.value = [msg(8, ['Hello, Seven.'])];
    await mount();
    await tick(700);
    expect(app.speakRadio).toHaveBeenCalledTimes(1);
    app.state.sheet.value = 'assay';
    await tick(100);
    expect(app.stopRadioSpeech).toHaveBeenCalledTimes(1);
    app.state.sheet.value = null;
    await tick(100);
    expect(app.speakRadio).toHaveBeenCalledTimes(2);
  });

  it('build mode (the story layer unmounts) stops the blips, and the message resumes at its card, not card 1', async () => {
    app.state.radio.value = [msg(9, ['One.', 'Two.', 'Three.'])];
    await mount();
    await tick(700);
    await flush(() => next().click());
    expect(text(dom.root.querySelector('.hf-radio-count'))).toBe('· 2/3');
    await unmount();
    expect(app.stopRadioSpeech).toHaveBeenCalledTimes(1);
    await tick(5_000); // building for a while: nothing speaks, nothing advances
    expect(app.speakRadio).toHaveBeenCalledTimes(2);
    await mount();
    expect(text(dom.root.querySelector('.hf-radio-count'))).toBe('· 2/3');
    expect(app.speakRadio).toHaveBeenCalledTimes(3);
    expect(app.speakRadio).toHaveBeenLastCalledWith('Dot', 'Two.');
  });
});
