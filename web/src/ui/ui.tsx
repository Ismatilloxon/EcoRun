import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { initials } from '../lib/format.ts';
import { useApp } from '../store.tsx';
import { Icon, type IconName } from './Icon.tsx';

export function NavBar({ title, back, right }: { title?: ReactNode; back?: string | true; right?: ReactNode }) {
  const nav = useNavigate();
  const { t } = useApp();
  return (
    <header className="navbar">
      {back ? (
        <button
          className="icon-btn"
          aria-label={t('common.back')}
          onClick={() => (typeof back === 'string' ? nav(back) : window.history.length > 1 ? nav(-1) : nav('/'))}
        >
          <Icon name="chevL" size={20} stroke={2.5} />
        </button>
      ) : (
        <span />
      )}
      <h1>{title}</h1>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>{right ?? <span />}</div>
    </header>
  );
}

export function LargeTitle({ title, eyebrow, right }: { title: ReactNode; eyebrow?: ReactNode; right?: ReactNode }) {
  return (
    <div className="large-title-row">
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="large-title">{title}</h1>
      </div>
      {right && <div className="row-flex" style={{ gap: 8 }}>{right}</div>}
    </div>
  );
}

export function Avatar({ src, name, size = 40 }: { src?: string | null; name?: string | null; size?: number }) {
  if (src) return <img className="avatar" src={assetUrl(src)} alt="" width={size} height={size} style={{ width: size, height: size }} />;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

type RowProps = {
  to?: string;
  onClick?: () => void;
  icon?: IconName | string;
  tile?: string;
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  danger?: boolean;
  accent?: boolean;
};
export function Row({ to, onClick, icon, tile = 'var(--accent-bg)', leading, title, subtitle, value, trailing, chevron, danger, accent }: RowProps) {
  const inner = (
    <>
      {leading ?? (icon ? <span className="tile" style={{ background: tile }} aria-hidden="true"><Icon name={icon} size={18} stroke={2} /></span> : null)}
      <span className="row-inner">
        <span className="row-text">
          <span className={danger ? 'danger' : accent ? 'accent' : undefined}>{title}</span>
          {subtitle && <span className="sub ellipsis">{subtitle}</span>}
        </span>
        {value != null && <span className="row-value">{value}</span>}
        {trailing}
        {(chevron ?? Boolean(to)) && <Icon name="chevR" size={14} stroke={2.4} className="chev" />}
      </span>
    </>
  );
  if (to) return <Link className="row" to={to}>{inner}</Link>;
  if (onClick) return <button type="button" className="row" onClick={onClick}>{inner}</button>;
  return <div className="row static">{inner}</div>;
}

export function List({ children, label, footer, round }: { children: ReactNode; label?: ReactNode; footer?: ReactNode; round?: boolean }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <section className="section" style={{ gap: 6 }}>
      {label && <h2 className="group-label">{label}</h2>}
      <ul className={`list ${round ? 'round' : ''}`}>
        {items.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      {footer && <p className="group-foot">{footer}</p>}
    </section>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chips<T extends string>({ value, onChange, options, multi, wrap, label }: { value: T | T[] | null; onChange: (v: any) => void; options: { value: T; label: ReactNode }[]; multi?: boolean; wrap?: boolean; label?: string }) {
  const selected = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className={`chips ${wrap ? 'wrap' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="chip"
          aria-pressed={selected(o.value)}
          onClick={() => {
            if (multi) {
              const arr = Array.isArray(value) ? value : [];
              onChange(arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value]);
            } else onChange(value === o.value ? null : o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

export function Stepper({ value, onChange, min = 0, max = 20, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="−" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="+" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>+</button>
    </span>
  );
}

export function Sheet({ open, onClose, title, children, right }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  const { t } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden="true" />
        <div className="sheet-head">
          <button type="button" className="btn plain" onClick={onClose} style={{ justifySelf: 'start' }}>{t('common.close')}</button>
          <h2 id={id}>{title}</h2>
          <div style={{ justifySelf: 'end' }}>{right}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Confirm({ open, text, onConfirm, onClose, danger, confirmLabel }: { open: boolean; text: ReactNode; onConfirm: () => void; onClose: () => void; danger?: boolean; confirmLabel?: string }) {
  const { t } = useApp();
  return (
    <Sheet open={open} onClose={onClose}>
      <p style={{ textAlign: 'center', padding: '0 8px' }}>{text}</p>
      <div className="btn-row">
        <button className="btn gray" onClick={onClose}>{t('common.cancel')}</button>
        <button className={`btn ${danger ? 'danger' : ''}`} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel ?? t('common.confirm')}</button>
      </div>
    </Sheet>
  );
}

export const Spinner = () => <div className="spinner" role="progressbar" aria-label="Loading" />;
export const Loading = () => (
  <div className="loading">
    <Spinner />
  </div>
);

export function Empty({ icon = 'info', text, action }: { icon?: IconName | string; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={34} stroke={1.5} />
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const { errorText, t } = useApp();
  return <Empty icon="warning" text={errorText(error)} action={retry && <button className="btn sm gray" onClick={retry}>{t('common.retry')}</button>} />;
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function TypeBadge({ type }: { type: string }) {
  const { t } = useApp();
  const cls = type === 'plogging' ? 'green' : type === 'training' ? 'blue' : type === 'race_prep' ? 'orange' : '';
  return <span className={`badge ${cls}`}>{t(`type.${type}`)}</span>;
}

export function PhotoInput({ value, onChange, label, required }: { value: string | null; onChange: (url: string | null, meta?: any) => void; label: string; required?: boolean }) {
  const { errorText, toast, t } = useApp();
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <div className="col" style={{ gap: 6 }}>
      <label htmlFor={id} className="footnote">
        {label} {required && <span className="badge">{t('eco.required')}</span>}
      </label>
      <div className="photo-input">
        {value ? <img src={assetUrl(value)} alt="" /> : busy ? <div className="spinner" /> : <span className="col" style={{ alignItems: 'center' }}><Icon name="camera" size={28} />{t('eco.addPhoto')}</span>}
        <input
          id={id}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              const r = await api.upload(f);
              onChange(r.url, r.meta);
            } catch (err) {
              toast(errorText(err), 'error');
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </div>
  );
}

export function Field({ label, children, stack }: { label: ReactNode; children: ReactElement<{ id?: string }>; stack?: boolean }) {
  const id = useId();
  return (
    <li className={`field ${stack ? 'stack' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {isValidElement(children) ? cloneElement(children, { id }) : children}
    </li>
  );
}
