// A minimal DOM for unit tests (the suite runs in Node; no jsdom): enough of Node / Element / Document /
// events for Preact to render components and for the input module to receive pointer and key events.
// Events take capture → target → bubble paths with stopPropagation and preventDefault; selectors cover
// compound simple selectors (tag, #id, .class, [attr], [attr="v"]), descendant combinators and lists.
import { act } from 'preact/test-utils';

type Listener = EventListenerOrEventListenerObject;
interface Entry {
  fn: Listener;
  capture: boolean;
  once: boolean;
}

export class FakeEvent {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  target: FakeEventTarget | null = null;
  currentTarget: FakeEventTarget | null = null;
  eventPhase = 0;
  defaultPrevented = false;
  isTrusted = true;
  timeStamp = performance.now();
  detail = 0;
  stopped = false;
  stoppedNow = false;
  [extra: string]: unknown;

  constructor(type: string, init: Record<string, unknown> = {}) {
    this.type = type;
    this.bubbles = (init.bubbles as boolean | undefined) ?? true;
    this.cancelable = (init.cancelable as boolean | undefined) ?? true;
    for (const [k, v] of Object.entries(init)) if (k !== 'bubbles' && k !== 'cancelable') this[k] = v;
  }
  preventDefault(): void {
    if (this.cancelable) this.defaultPrevented = true;
  }
  stopPropagation(): void {
    this.stopped = true;
  }
  stopImmediatePropagation(): void {
    this.stopped = true;
    this.stoppedNow = true;
  }
}

export class FakeEventTarget {
  private readonly listeners = new Map<string, Entry[]>();

  addEventListener(type: string, fn: Listener | null, opt?: boolean | AddEventListenerOptions): void {
    if (!fn) return;
    const capture = typeof opt === 'boolean' ? opt : !!opt?.capture;
    const once = typeof opt === 'object' && !!opt.once;
    const list = this.listeners.get(type) ?? [];
    if (list.some((l) => l.fn === fn && l.capture === capture)) return;
    list.push({ fn, capture, once });
    this.listeners.set(type, list);
  }
  removeEventListener(type: string, fn: Listener | null, opt?: boolean | EventListenerOptions): void {
    const capture = typeof opt === 'boolean' ? opt : !!opt?.capture;
    const list = this.listeners.get(type);
    if (!list || !fn) return;
    const i = list.findIndex((l) => l.fn === fn && l.capture === capture);
    if (i >= 0) list.splice(i, 1);
  }
  /** Listener count for a type (tests). */
  listenerCount(type: string): number {
    return this.listeners.get(type)?.length ?? 0;
  }
  /** Invoke this target's listeners for one phase. */
  invoke(ev: FakeEvent, phase: 'capture' | 'target' | 'bubble'): void {
    const list = this.listeners.get(ev.type);
    if (!list) return;
    ev.currentTarget = this;
    for (const l of [...list]) {
      if (phase === 'capture' && !l.capture) continue;
      if (phase === 'bubble' && l.capture) continue;
      if (l.once) this.removeEventListener(ev.type, l.fn, l.capture);
      if (typeof l.fn === 'function') l.fn.call(this, ev as unknown as Event);
      else l.fn.handleEvent(ev as unknown as Event);
      if (ev.stoppedNow) return;
    }
  }
  /** Parent in the event path (nodes: parentNode; the document: the window). */
  eventParent(): FakeEventTarget | null {
    return null;
  }
  dispatchEvent(e: FakeEvent | Event): boolean {
    const ev = e as unknown as FakeEvent;
    ev.target = this;
    const path: FakeEventTarget[] = [];
    for (let t = this.eventParent(); t; t = t.eventParent()) path.push(t);
    ev.eventPhase = 1;
    for (let i = path.length - 1; i >= 0 && !ev.stopped; i--) path[i].invoke(ev, 'capture');
    if (!ev.stopped) {
      ev.eventPhase = 2;
      this.invoke(ev, 'target');
    }
    if (ev.bubbles) {
      ev.eventPhase = 3;
      for (let i = 0; i < path.length && !ev.stopped; i++) path[i].invoke(ev, 'bubble');
    }
    ev.eventPhase = 0;
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}

export class FakeNode extends FakeEventTarget {
  nodeType = 1;
  parentNode: FakeNode | null = null;
  readonly childNodes: FakeNode[] = [];
  ownerDocument: FakeDocument | null = null;

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): FakeNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get nextSibling(): FakeNode | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) + 1] ?? null) : null;
  }
  get previousSibling(): FakeNode | null {
    const p = this.parentNode;
    return p ? (p.childNodes[p.childNodes.indexOf(this) - 1] ?? null) : null;
  }
  get parentElement(): FakeElement | null {
    return this.parentNode instanceof FakeElement ? this.parentNode : null;
  }
  get isConnected(): boolean {
    let n: FakeNode | null = this;
    while (n.parentNode) n = n.parentNode;
    return n instanceof FakeDocument;
  }
  get textContent(): string {
    return this.childNodes.map((c) => c.textContent).join('');
  }
  override eventParent(): FakeEventTarget | null {
    return this.parentNode;
  }
  insertBefore<T extends FakeNode>(node: T, ref: FakeNode | null): T {
    if (node.parentNode) node.parentNode.removeChild(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(node);
    else this.childNodes.splice(i, 0, node);
    node.parentNode = this;
    return node;
  }
  appendChild<T extends FakeNode>(node: T): T {
    return this.insertBefore(node, null);
  }
  removeChild<T extends FakeNode>(node: T): T {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) this.childNodes.splice(i, 1);
    node.parentNode = null;
    return node;
  }
  remove(): void {
    this.parentNode?.removeChild(this);
  }
  contains(node: FakeNode | null): boolean {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
}

export class FakeText extends FakeNode {
  data: string;
  constructor(data: string) {
    super();
    this.nodeType = 3;
    this.data = String(data);
  }
  get nodeValue(): string {
    return this.data;
  }
  override get textContent(): string {
    return this.data;
  }
}

export class FakeComment extends FakeText {
  constructor(data: string) {
    super(data);
    this.nodeType = 8;
  }
  override get textContent(): string {
    return '';
  }
}

interface FakeStyle {
  [prop: string]: unknown;
  cssText: string;
  setProperty(name: string, value: string): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): void;
}

function makeStyle(): FakeStyle {
  const custom = new Map<string, string>();
  return {
    cssText: '',
    setProperty(name: string, value: string) {
      custom.set(name, String(value));
    },
    getPropertyValue(name: string) {
      return custom.get(name) ?? '';
    },
    removeProperty(name: string) {
      custom.delete(name);
    },
  };
}

const camelToData = (k: string): string => `data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

export class FakeElement extends FakeNode {
  readonly localName: string;
  readonly namespaceURI: string;
  readonly attrs = new Map<string, string>();
  readonly style: FakeStyle = makeStyle();
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 0;
  clientHeight = 0;
  scrollWidth = 0;
  clientWidth = 0;
  isContentEditable = false;
  rect = { left: 0, top: 0, width: 0, height: 0 };
  readonly captured = new Set<number>();

  constructor(localName: string, ns = 'http://www.w3.org/1999/xhtml') {
    super();
    this.localName = localName;
    this.namespaceURI = ns;
  }
  get tagName(): string {
    return this.localName.toUpperCase();
  }
  get nodeName(): string {
    return this.tagName;
  }
  get id(): string {
    return this.getAttribute('id') ?? '';
  }
  get className(): string {
    return this.getAttribute('class') ?? '';
  }
  set className(v: string) {
    this.setAttribute('class', v);
  }
  get disabled(): boolean {
    return this.attrs.has('disabled');
  }
  set disabled(v: boolean) {
    if (v) this.attrs.set('disabled', '');
    else this.attrs.delete('disabled');
  }
  get classList() {
    const read = () => this.className.split(/\s+/).filter(Boolean);
    const write = (c: string[]) => this.setAttribute('class', c.join(' '));
    return {
      contains: (c: string) => read().includes(c),
      add: (...cs: string[]) => write([...new Set([...read(), ...cs])]),
      remove: (...cs: string[]) => write(read().filter((c) => !cs.includes(c))),
      toggle: (c: string, force?: boolean) => {
        const on = force ?? !read().includes(c);
        write(on ? [...new Set([...read(), c])] : read().filter((x) => x !== c));
        return on;
      },
    };
  }
  get dataset(): Record<string, string | undefined> {
    return new Proxy({} as Record<string, string | undefined>, {
      get: (_t, k) => (typeof k === 'string' ? (this.getAttribute(camelToData(k)) ?? undefined) : undefined),
      set: (_t, k, v) => {
        if (typeof k === 'string') this.setAttribute(camelToData(k), String(v));
        return true;
      },
    });
  }
  get attributes(): { name: string; value: string }[] {
    return [...this.attrs].map(([name, value]) => ({ name, value }));
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  setAttribute(name: string, value: unknown): void {
    this.attrs.set(name, String(value));
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  get children(): FakeElement[] {
    return this.childNodes.filter((c): c is FakeElement => c instanceof FakeElement);
  }
  matches(selector: string): boolean {
    return matchesList(this, selector);
  }
  closest(selector: string): FakeElement | null {
    for (let n: FakeNode | null = this; n; n = n.parentNode) if (n instanceof FakeElement && n.matches(selector)) return n;
    return null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (n: FakeNode): void => {
      for (const c of n.childNodes) {
        if (c instanceof FakeElement) {
          if (c.matches(selector)) out.push(c);
          walk(c);
        }
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }
  blur(): void {}
  /** Like HTMLElement.click(): a synthetic, untrusted click (none on a disabled control). */
  click(): void {
    if (this.disabled) return;
    this.dispatchEvent(new FakeEvent('click', { isTrusted: false, detail: 0, button: 0 }));
  }
  animate(): { cancel(): void } {
    return { cancel() {} };
  }
  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height };
  }
  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }
}

export class FakeDocument extends FakeNode {
  readonly documentElement: FakeElement;
  readonly body: FakeElement;
  activeElement: FakeElement | null = null;
  visibilityState: 'visible' | 'hidden' = 'visible';
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml';
  window: FakeWindow | null = null;

  constructor() {
    super();
    this.nodeType = 9;
    this.ownerDocument = null;
    this.documentElement = this.adopt(new FakeElement('html'));
    this.body = this.adopt(new FakeElement('body'));
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  private adopt<T extends FakeNode>(n: T): T {
    n.ownerDocument = this;
    return n;
  }
  override eventParent(): FakeEventTarget | null {
    return this.window;
  }
  createElement(name: string): FakeElement {
    return this.adopt(makeElement(name.toLowerCase()));
  }
  createElementNS(ns: string | null, name: string): FakeElement {
    return this.adopt(makeElement(name, ns ?? 'http://www.w3.org/1999/xhtml'));
  }
  createTextNode(data: string): FakeText {
    return this.adopt(new FakeText(data));
  }
  createComment(data: string): FakeComment {
    return this.adopt(new FakeComment(data));
  }
  /** Legacy clipboard path (ui/clipboard.ts): unsupported here. */
  execCommand(): boolean {
    return false;
  }
}

export class FakeWindow extends FakeEventTarget {
  innerWidth = 375;
  innerHeight = 667;
}

export class FakeTextArea extends FakeElement {
  value = '';
  select(): void {}
}
export class FakeInput extends FakeElement {
  value = '';
}
export class FakeSelect extends FakeElement {}

function makeElement(name: string, ns?: string): FakeElement {
  if (name === 'textarea') return new FakeTextArea(name, ns);
  if (name === 'input') return new FakeInput(name, ns);
  if (name === 'select') return new FakeSelect(name, ns);
  return new FakeElement(name, ns);
}

// ---------------------------------------------------------------- selectors

interface Compound {
  tag: string | null;
  id: string | null;
  classes: string[];
  attrs: { name: string; value: string | null }[];
}

function parseCompound(s: string): Compound {
  const c: Compound = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = re.exec(s))) {
    if (m.index !== consumed) break;
    consumed = re.lastIndex;
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4], value: m[5] ?? m[6] ?? m[7] ?? null });
  }
  if (consumed !== s.length) throw new Error(`fake DOM: unsupported selector "${s}"`);
  return c;
}

function matchesCompound(el: FakeElement, c: Compound): boolean {
  if (c.tag && el.localName.toLowerCase() !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  const cls = el.className.split(/\s+/);
  if (c.classes.some((k) => !cls.includes(k))) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null || (a.value !== null && v !== a.value)) return false;
  }
  return true;
}

function matchesComplex(el: FakeElement, parts: Compound[]): boolean {
  if (!matchesCompound(el, parts[parts.length - 1])) return false;
  let i = parts.length - 2;
  for (let n = el.parentElement; n && i >= 0; n = n.parentElement) if (matchesCompound(n, parts[i])) i--;
  return i < 0;
}

function matchesList(el: FakeElement, selector: string): boolean {
  return selector.split(',').some((s) => matchesComplex(el, s.trim().split(/\s+/).map(parseCompound)));
}

// ---------------------------------------------------------------- install

export interface FakeDom {
  document: FakeDocument;
  window: FakeWindow;
  /** A #ui-like root attached to the body. */
  root: FakeElement;
  /** Media queries that match (matchMedia), e.g. '(prefers-reduced-motion: reduce)'. */
  media: Set<string>;
  /** Advance the fake requestAnimationFrame queue by one frame. */
  frame(): void;
  restore(): void;
}

const GLOBALS = [
  'document',
  'window',
  'Node',
  'Element',
  'HTMLElement',
  'Text',
  'HTMLTextAreaElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'matchMedia',
] as const;

/** Install the fake DOM as globals (document, window, Element, …). Call restore() in afterEach. */
export function installFakeDom(): FakeDom {
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, unknown>(GLOBALS.map((k) => [k, g[k]]));
  const document = new FakeDocument();
  const window = new FakeWindow();
  document.window = window;
  let rafId = 0;
  let queue = new Map<number, FrameRequestCallback>();
  const media = new Set<string>();
  Object.assign(g, {
    document,
    window,
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    Text: FakeText,
    HTMLTextAreaElement: FakeTextArea,
    HTMLInputElement: FakeInput,
    HTMLSelectElement: FakeSelect,
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      queue.set(++rafId, cb);
      return rafId;
    },
    cancelAnimationFrame: (id: number) => {
      queue.delete(id);
    },
    // No layout: every box measures 0 (safe-area probe paddings included).
    getComputedStyle: () => ({ paddingTop: '0px', paddingBottom: '0px', paddingLeft: '0px', paddingRight: '0px', getPropertyValue: () => '' }),
    matchMedia: (query: string) => ({ matches: media.has(query), media: query, addEventListener() {}, removeEventListener() {} }),
  });
  const root = document.createElement('div');
  root.setAttribute('id', 'ui');
  document.body.appendChild(root);
  return {
    document,
    window,
    root,
    media,
    frame() {
      const run = queue;
      queue = new Map();
      for (const cb of run.values()) cb(performance.now());
    },
    restore() {
      for (const [k, v] of saved) {
        if (v === undefined) delete g[k];
        else g[k] = v;
      }
    },
  };
}

/** Render inside act() so effects and signal-driven re-renders flush before returning. */
export async function flush(run: () => void = () => {}): Promise<void> {
  await act(run);
}

/** Dispatch a bubbling pointer event (touch by default) at an element, inside act(). */
export async function pointer(
  el: FakeElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  init: { pointerId: number; x?: number; y?: number; pointerType?: string; t?: number },
): Promise<FakeEvent> {
  const ev = new FakeEvent(type, {
    pointerId: init.pointerId,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
    pointerType: init.pointerType ?? 'touch',
    button: 0,
    isPrimary: init.pointerId === 1,
  });
  if (init.t !== undefined) ev.timeStamp = init.t;
  await act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

/** A trusted click as the browser synthesizes it after a single-pointer tap (detail = 1). */
export async function nativeClick(el: FakeElement): Promise<FakeEvent> {
  const ev = new FakeEvent('click', { detail: 1, button: 0 });
  await act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

/** Dispatch a key event on the fake window. */
export async function key(win: FakeWindow, type: 'keydown' | 'keyup', code: string, repeat = false): Promise<FakeEvent> {
  const ev = new FakeEvent(type, { code, key: code, repeat, metaKey: false, ctrlKey: false, altKey: false });
  await act(() => {
    win.dispatchEvent(ev);
  });
  return ev;
}

/** Text of an element with whitespace collapsed. */
export function text(el: FakeNode | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}
