import { Link } from 'react-router-dom';
import { fmtDistanceAway, fmtTime, fmtWhen } from '../lib/format.ts';
import { useApp } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { TypeBadge } from '../ui/ui.tsx';

export type RunLite = {
  id: string;
  title: string;
  type: string;
  start_at: string;
  meeting_address: string | null;
  distance_km: number | null;
  pace_groups: string[];
  level: string | null;
  capacity: number | null;
  women_only: boolean;
  requires_approval: boolean;
  participants_count: number;
  waitlist_count?: number;
  my_status?: string | null;
  distance_m?: number | null;
  club?: { id: string; name: string; verified: boolean } | null;
  organizer?: { id: string; name: string | null };
  recurrence_rule?: string | null;
  status?: string;
  meeting_lat?: number;
  meeting_lng?: number;
};

const typeColor: Record<string, string> = { plogging: '#8a5a00', training: '#0066cc', race_prep: '#c93400', casual: 'var(--accent-bg)' };

export function RunRow({ run, showDay = true }: { run: RunLite; showDay?: boolean }) {
  const { t, lang } = useApp();
  const spots = run.capacity ? run.capacity - run.participants_count : null;
  return (
    <Link className="row" to={`/runs/${run.id}`}>
      <span className="tile md" style={{ background: typeColor[run.type] ?? 'var(--accent-bg)' }} aria-hidden="true">
        <Icon name={run.type === 'plogging' ? 'leaf' : run.type === 'training' ? 'bolt' : run.type === 'race_prep' ? 'trophy' : 'runner'} size={20} stroke={2} />
      </span>
      <span className="row-inner" style={{ minHeight: 72 }}>
        <span className="row-text" style={{ gap: 2 }}>
          <span className="headline ellipsis">{run.title}</span>
          <span className="sub ellipsis">
            {showDay ? fmtWhen(run.start_at, lang, t) : fmtTime(run.start_at, lang)}
            {run.distance_km ? ` · ${run.distance_km} ${t('common.km')}` : ''}
            {run.pace_groups?.length ? ` · ${run.pace_groups.join(', ')}` : ''}
          </span>
          <span className="row-flex wrap" style={{ gap: 6, marginTop: 2 }}>
            <TypeBadge type={run.type} />
            {run.women_only && <span className="badge purple">{t('runs.womenOnly')}</span>}
            {run.recurrence_rule && <span className="badge">{t('runs.weekly')}</span>}
            {run.my_status && ['joined', 'checked_in', 'waitlist', 'pending'].includes(run.my_status) && (
              <span className={`badge ${run.my_status === 'joined' || run.my_status === 'checked_in' ? 'green' : 'orange'}`}>{t(`status.${run.my_status}`)}</span>
            )}
            {run.distance_m != null && <span className="caption">{fmtDistanceAway(run.distance_m)}</span>}
          </span>
        </span>
        <span className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
          <span className="footnote">
            <Icon name="people" size={14} /> {run.participants_count}
            {run.capacity ? `/${run.capacity}` : ''}
          </span>
          {spots != null && spots <= 0 && <span className="badge orange">{t('runs.full')}</span>}
        </span>
        <Icon name="chevR" size={14} stroke={2.4} className="chev" />
      </span>
    </Link>
  );
}

export function groupByDay<T extends { start_at: string }>(runs: T[]) {
  const out: { key: string; items: T[] }[] = [];
  for (const r of runs) {
    const key = new Date(r.start_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' });
    const last = out.at(-1);
    if (last?.key === key) last.items.push(r);
    else out.push({ key, items: [r] });
  }
  return out;
}
