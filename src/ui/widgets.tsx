// Small shared UI widgets (03 §10.4): chunky buttons with a 4-pt press lip, switches, segmented controls.
import type { ComponentChildren, CSSProperties, JSX } from 'preact';
import { Icon, type IconName } from './icons';

export type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonProps {
  kind?: ButtonKind;
  /** Pinned sheet action: 64 pt tall, full width. */
  big?: boolean;
  disabled?: boolean;
  label?: string;
  icon?: IconName;
  class?: string;
  onClick?: () => void;
  children?: ComponentChildren;
}

export function Button({ kind = 'secondary', big, disabled, label, icon, class: cls, onClick, children }: ButtonProps): JSX.Element {
  const classes = `hf-btn hf-btn-${kind}${big ? ' hf-btn-big' : ''}${cls ? ` ${cls}` : ''}`;
  return (
    <button type="button" class={classes} disabled={disabled} aria-label={label} onClick={onClick}>
      {icon && <Icon name={icon} size={big ? 24 : 20} />}
      {children}
    </button>
  );
}

export function Switch({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button type="button" class="hf-row hf-switch-row" role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span class="hf-row-text">
        <span class="hf-row-label">{label}</span>
        {hint && <span class="hf-row-hint">{hint}</span>}
      </span>
      <span class={value ? 'hf-switch hf-on' : 'hf-switch'} aria-hidden="true">
        <i />
      </span>
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (v: T) => void;
}): JSX.Element {
  return (
    <div class="hf-row hf-seg-row">
      <span class="hf-row-label">{label}</span>
      <div class="hf-seg" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            class={o.value === value ? 'hf-seg-btn hf-on' : 'hf-seg-btn'}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ComponentChildren }): JSX.Element {
  return <h3 class="hf-section">{children}</h3>;
}

/** Horizontal fill bar (transform-only animation). */
export function Bar({ frac, color, class: cls }: { frac: number; color: string; class?: string }): JSX.Element {
  const f = frac <= 0 ? 0 : frac >= 1 ? 1 : frac;
  return (
    <span class={cls ? `hf-bar ${cls}` : 'hf-bar'} style={{ '--f': String(f), '--c': color }}>
      <i />
    </span>
  );
}
