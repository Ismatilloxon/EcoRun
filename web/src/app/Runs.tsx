import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { approxPosition, type LatLng } from '../lib/geo.ts';
import { fmtDay } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Chips, Empty, ErrorBox, LargeTitle, List, Loading, Segmented, Sheet } from '../ui/ui.tsx';
import { MapView } from '../components/MapView.tsx';
import { groupByDay, RunRow, type RunLite } from '../components/RunCard.tsx';

type Filters = { date: string | null; dist: string | null; pace: string | null; level: string | null; district: string | null; type: string | null; club: string | null };
const EMPTY: Filters = { date: null, dist: null, pace: null, level: null, district: null, type: null, club: null };

function dateRange(key: string | null) {
  if (!key) return {};
  const tz = (d: Date) => new Date(new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Tashkent' }) + 'T00:00:00+05:00');
  const start = tz(new Date());
  if (key === 'today') return { from: new Date().toISOString(), to: new Date(start.getTime() + 86400_000).toISOString() };
  if (key === 'tomorrow') return { from: new Date(start.getTime() + 86400_000).toISOString(), to: new Date(start.getTime() + 2 * 86400_000).toISOString() };
  return { to: new Date(start.getTime() + 7 * 86400_000).toISOString() };
}

export function Runs() {
  const { t, lang, me } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [view, setView] = useState<'list' | 'map'>('list');
  const [filters, setFilters] = useState<Filters>({ ...EMPTY, type: sp.get('type'), club: sp.get('club') });
  const [draft, setDraft] = useState<Filters>(filters);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [meta] = useLoad<{ districts: string[] }>(() => api.get('/meta'));
  const [clubs] = useLoad<any[]>(() => api.get('/clubs'));

  useEffect(() => {
    approxPosition().then(setPos);
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (pos) {
      p.set('lat', String(pos.lat));
      p.set('lng', String(pos.lng));
    }
    const r = dateRange(filters.date);
    if (r.from) p.set('from', r.from);
    if (r.to) p.set('to', r.to);
    if (filters.dist === 'short') p.set('max_km', '5');
    if (filters.dist === 'mid') (p.set('min_km', '5'), p.set('max_km', '10'));
    if (filters.dist === 'long') p.set('min_km', '10');
    for (const k of ['pace', 'level', 'district', 'type', 'club'] as const) if (filters[k]) p.set(k, filters[k]!);
    return p.toString();
  }, [filters, pos]);

  const [runs, loading, error, reload] = useLoad<RunLite[]>(() => api.get(`/runs?${qs}`), [qs, me?.id]);
  const active = Object.values(filters).filter(Boolean).length;
  const groups = useMemo(() => groupByDay(runs ?? []), [runs]);

  const markers = useMemo(
    () =>
      (runs ?? []).map((r) => ({
        id: r.id,
        lat: r.meeting_lat!,
        lng: r.meeting_lng!,
        kind: r.type,
        title: r.title,
        onClick: () => nav(`/runs/${r.id}`),
      })),
    [runs, nav],
  );

  return (
    <main className="screen tight">
      <LargeTitle
        title={t('runs.title')}
        right={
          <>
            <button className="icon-btn" aria-label={t('runs.filters')} onClick={() => { setDraft(filters); setOpen(true); }}>
              <Icon name="sliders" size={22} />
              {active > 0 && <span className="dot">{active}</span>}
            </button>
            <Link className="icon-btn accent" to={me ? '/runs/new' : '/welcome'} aria-label={t('runs.create')}>
              <Icon name="plus" size={22} stroke={2.4} />
            </Link>
          </>
        }
      />
      <div className="chips">
        <Link className="chip" to="/clubs"><Icon name="people" size={16} /> {t('runs.clubs')}</Link>
        <Link className="chip" to="/events"><Icon name="ticket" size={16} /> {t('runs.events')}</Link>
        <Link className="chip" to="/eco/spots"><Icon name="pin" size={16} /> {t('eco.spots')}</Link>
        {me && <Link className="chip" to="/profile/runs"><Icon name="calendar" size={16} /> {t('runs.mine')}</Link>}
      </div>
      <Segmented value={view} onChange={setView} options={[{ value: 'list', label: t('runs.list') }, { value: 'map', label: t('runs.map') }]} label={t('runs.title')} />
      <Chips
        value={filters.type}
        onChange={(v) => setFilters((f) => ({ ...f, type: v }))}
        options={(['casual', 'training', 'plogging', 'race_prep'] as const).map((x) => ({ value: x, label: t(`type.${x}`) }))}
        label={t('f.type')}
      />

      {view === 'map' && <MapView className="map tall" markers={markers} me={pos} fit={markers.length > 0} center={pos ?? undefined} label={t('runs.map')} />}

      {loading && !runs ? (
        <Loading />
      ) : error ? (
        <ErrorBox error={error} retry={reload} />
      ) : !runs?.length ? (
        <Empty icon="runner" text={t('runs.empty')} action={active ? <button className="btn sm gray" onClick={() => setFilters(EMPTY)}>{t('f.reset')}</button> : null} />
      ) : (
        groups.map((g) => (
          <List key={g.key} label={fmtDay(g.items[0].start_at, lang, t)}>
            {g.items.map((r) => <RunRow key={r.id} run={r} showDay={false} />)}
          </List>
        ))
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('runs.filters')}
        right={<button className="btn plain" onClick={() => setDraft(EMPTY)}>{t('f.reset')}</button>}
      >
        {(
          [
            ['date', t('f.date'), [['today', t('f.today')], ['tomorrow', t('f.tomorrow')], ['week', t('f.week')]]],
            ['dist', t('f.distance'), [['short', t('f.d.short')], ['mid', t('f.d.mid')], ['long', t('f.d.long')]]],
            ['level', t('f.level'), (['beginner', 'intermediate', 'advanced'] as const).map((l) => [l, t(`level.${l}`)])],
            ['pace', t('f.pace'), ['4:30', '5:00', '5:30', '6:00', '6:30', '7:00'].map((p) => [p, `${p}${t('common.perKm')}`])],
            ['type', t('f.type'), (['casual', 'training', 'plogging', 'race_prep'] as const).map((x) => [x, t(`type.${x}`)])],
          ] as [keyof Filters, string, [string, string][]][]
        ).map(([k, label, opts]) => (
          <section key={k} className="col" style={{ gap: 8 }}>
            <h3 className="group-label">{label}</h3>
            <Chips value={draft[k]} onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} options={opts.map(([value, l]) => ({ value, label: l }))} wrap label={label} />
          </section>
        ))}
        <ul className="field-list">
          <li className="field">
            <label htmlFor="f-district">{t('f.district')}</label>
            <select id="f-district" value={draft.district ?? ''} onChange={(e) => setDraft((d) => ({ ...d, district: e.target.value || null }))}>
              <option value="">{t('f.any')}</option>
              {meta?.districts.map((d) => <option key={d}>{d}</option>)}
            </select>
          </li>
          <li className="field">
            <label htmlFor="f-club">{t('f.club')}</label>
            <select id="f-club" value={draft.club ?? ''} onChange={(e) => setDraft((d) => ({ ...d, club: e.target.value || null }))}>
              <option value="">{t('f.any')}</option>
              {clubs?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </li>
        </ul>
        <button className="btn block" onClick={() => { setFilters(draft); setOpen(false); }}>{t('f.show')}</button>
      </Sheet>
    </main>
  );
}
