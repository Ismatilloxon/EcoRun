import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { LANGS } from './i18n/index.ts';
import { useApp } from './store.tsx';
import { Icon } from './ui/Icon.tsx';
import { Segmented } from './ui/ui.tsx';

export type NavItem = { to: string; icon: string; label: string; badge?: number };

export function CabinetLayout({ title, nav, children }: { title: string; nav: NavItem[]; children: ReactNode }) {
  const { t, lang, setLang, me } = useApp();
  const navigate = useNavigate();
  return (
    <div className="cab">
      <aside className="cab-side" aria-label={title}>
        <div className="cab-brand">
          <img src="/icon.svg" alt="" width={28} height={28} style={{ borderRadius: 7 }} />
          <span>EcoRun · {title}</span>
        </div>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to.split('/').length <= 2} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon name={n.icon} size={18} />
            <span className="grow">{n.label}</span>
            {n.badge ? <span className="badge red">{n.badge}</span> : null}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ padding: '8px 4px' }}>
          <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.code.toUpperCase() }))} label="Language" />
        </div>
        <button className="navlink" onClick={() => navigate('/profile')}>
          <Icon name="chevL" size={18} /> {t('adm.backToApp')}
        </button>
        <p className="caption" style={{ padding: '4px 10px' }}>{me?.name} · {me?.role}</p>
      </aside>
      <main className="cab-main">{children}</main>
    </div>
  );
}

export function CabHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="cab-head">
      <h1>{title}</h1>
      <div className="toolbar">{children}</div>
    </div>
  );
}

export function Kpi({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      {hint && <span className="caption">{hint}</span>}
    </div>
  );
}

/** Single-series bar chart: thin marks, recessive axis, per-bar hover tooltip, accessible table fallback. */
export function BarChart({ data, label, valueLabel }: { data: { x: string; y: number }[]; label: string; valueLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 160;
  const pad = { t: 10, r: 8, b: 22, l: 30 };
  const max = Math.max(1, ...data.map((d) => d.y));
  const nice = Math.ceil(max / 5) * 5 || 5;
  const bw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ticks = [0, nice / 2, nice];
  return (
    <figure style={{ margin: 0, position: 'relative' }}>
      <figcaption className="headline" style={{ marginBottom: 6 }}>{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={label} onMouseLeave={() => setHover(null)}>
        {ticks.map((tk) => (
          <g key={tk}>
            <line x1={pad.l} x2={W - pad.r} y1={y(tk)} y2={y(tk)} stroke="var(--sep)" strokeWidth={1} />
            <text x={pad.l - 6} y={y(tk) + 4} textAnchor="end" fontSize={11} fill="var(--label-2)">{tk}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(0, y(0) - y(d.y));
          const x = pad.l + i * bw + 1;
          const w = Math.max(1, bw - 2);
          return (
            <g key={d.x} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.x}: ${d.y}`}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && <path d={`M${x},${y(0)} v${-(h - Math.min(4, h))} q0,-${Math.min(4, h)} ${Math.min(4, w / 2)},-${Math.min(4, h)} h${w - 2 * Math.min(4, w / 2)} q${Math.min(4, w / 2)},0 ${Math.min(4, w / 2)},${Math.min(4, h)} v${h - Math.min(4, h)} z`} fill={hover === i ? 'var(--accent)' : 'var(--accent-bg)'} />}
            </g>
          );
        })}
        {[0, Math.floor(data.length / 2), data.length - 1].filter((i) => data[i]).map((i) => (
          <text key={i} x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--label-2)">{data[i].x.slice(5)}</text>
        ))}
      </svg>
      {hover != null && data[hover] && (
        <div className="toast" style={{ position: 'absolute', top: 24, left: `${Math.min(80, ((hover + 0.5) / data.length) * 100)}%`, transform: 'translateX(-50%)', pointerEvents: 'none', padding: '6px 10px', fontSize: 13 }}>
          <b>{data[hover].y}</b> {valueLabel} · {data[hover].x}
        </div>
      )}
      <details>
        <summary className="caption" style={{ cursor: 'pointer' }}>Table</summary>
        <table className="tbl"><tbody>{data.map((d) => <tr key={d.x}><td>{d.x}</td><td>{d.y}</td></tr>)}</tbody></table>
      </details>
    </figure>
  );
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const id = setTimeout(() => setD(v), ms);
    return () => clearTimeout(id);
  }, [v, ms]);
  return d;
}
