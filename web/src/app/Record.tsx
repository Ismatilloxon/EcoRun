import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.ts';
import { distanceM, TASHKENT } from '../lib/geo.ts';
import { fmtDateTime, fmtDuration, fmtKm, fmtPace, fmtWhen } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Confirm, Empty, ErrorBox, LargeTitle, List, Loading, NavBar, Row, Switch } from '../ui/ui.tsx';
import { MapView } from '../components/MapView.tsx';

type Pt = { lat: number; lng: number; t: number; acc?: number };
type Active = { startedAt: number; elapsed: number; resumedAt: number | null; track: Pt[]; distance: number; commute: boolean; runId: string | null; simulated?: boolean };

const ACTIVE_KEY = 'activeRun';
const PENDING_KEY = 'pendingActivities';
const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    if (v == null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full or blocked */
  }
};

/** Retries runs saved while offline. */
export async function flushPendingActivities() {
  const list = read<any[]>(PENDING_KEY, []);
  if (!list.length) return 0;
  const left: any[] = [];
  for (const body of list) {
    try {
      await api.post('/activities', body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) left.push(body);
    }
  }
  write(PENDING_KEY, left.length ? left : null);
  return list.length - left.length;
}

export function Record() {
  const { t, lang, toast, errorText } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [state, setState] = useState<Active | null>(() => read<Active | null>(ACTIVE_KEY, null));
  const [gps, setGps] = useState<'idle' | 'waiting' | 'ok' | 'weak' | 'denied'>('idle');
  const [now, setNow] = useState(Date.now());
  const [summary, setSummary] = useState<any>(null);
  const [discard, setDiscard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mine] = useLoad<any>(() => api.get('/runs/mine'));
  const [history, , , reloadHistory] = useLoad<any[]>(() => api.get('/me/activities'));
  const watch = useRef<number | null>(null);
  const wake = useRef<any>(null);
  const sim = useRef<ReturnType<typeof setInterval> | null>(null);
  const simEnabled = import.meta.env.DEV || sp.get('sim') === '1';
  const pending = read<any[]>(PENDING_KEY, []).length;

  const recording = Boolean(state?.resumedAt);
  const elapsed = state ? state.elapsed + (state.resumedAt ? now - state.resumedAt : 0) : 0;
  const todayRuns = useMemo(
    () => (mine?.upcoming ?? []).concat(mine?.past ?? []).filter((r: any) => Math.abs(new Date(r.start_at).getTime() - Date.now()) < 12 * 3600_000),
    [mine],
  );

  useEffect(() => {
    write(ACTIVE_KEY, state);
  }, [state]);
  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const addPoint = (p: Pt) =>
    setState((s) => {
      if (!s || !s.resumedAt) return s;
      const last = s.track.at(-1);
      const d = last ? distanceM(last, p) : 0;
      if (last && d < 3 && p.t - last.t < 10_000) return s;
      return { ...s, track: [...s.track, p], distance: s.distance + (last && last.t >= s.resumedAt - 1000 ? d : 0) };
    });

  const startWatch = () => {
    if (!('geolocation' in navigator)) return setGps('denied');
    setGps('waiting');
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = pos.coords.accuracy;
        setGps(acc > 50 ? 'weak' : 'ok');
        if (acc > 50) return;
        addPoint({ lat: pos.coords.latitude, lng: pos.coords.longitude, t: pos.timestamp || Date.now(), acc: Math.round(acc) });
      },
      (err) => setGps(err.code === 1 ? 'denied' : 'weak'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  };
  const stopWatch = () => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    if (sim.current) clearInterval(sim.current);
    sim.current = null;
  };

  const lockScreen = async () => {
    try {
      wake.current = await (navigator as any).wakeLock?.request('screen');
    } catch {
      /* not supported */
    }
  };
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && recording && lockScreen();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [recording]);

  // Resume an in-progress run after reload.
  useEffect(() => {
    if (state?.resumedAt) {
      startWatch();
      lockScreen();
    }
    return () => {
      stopWatch();
      wake.current?.release?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    const ts = Date.now();
    setSummary(null);
    setState({ startedAt: ts, elapsed: 0, resumedAt: ts, track: [], distance: 0, commute: false, runId: todayRuns.find((r: any) => r.my_status === 'checked_in')?.id ?? null });
    startWatch();
    lockScreen();
  };
  const pause = () => {
    stopWatch();
    wake.current?.release?.();
    setState((s) => (s && s.resumedAt ? { ...s, elapsed: s.elapsed + (Date.now() - s.resumedAt), resumedAt: null } : s));
  };
  const resume = () => {
    setState((s) => (s ? { ...s, resumedAt: Date.now() } : s));
    startWatch();
    lockScreen();
  };

  // Demo: synthetic run at ~5:45/km, 10× speed, around Tashkent City Park.
  const simulate = () => {
    const ts = Date.now();
    const center = TASHKENT;
    let i = 0;
    const base: Active = { startedAt: ts - 1, elapsed: 0, resumedAt: ts, track: [], distance: 0, commute: false, runId: null, simulated: true };
    setState(base);
    setGps('ok');
    sim.current = setInterval(() => {
      i++;
      const ang = ((i * 29) / 1400) * 2 * Math.PI;
      const r = 1400 / (2 * Math.PI) / 111000;
      const p = { lat: center.lat + r * Math.sin(ang), lng: center.lng + (r * Math.cos(ang)) / Math.cos((center.lat * Math.PI) / 180), t: ts + i * 10_000 };
      setState((s) => {
        if (!s || !s.resumedAt) return s;
        const last = s.track.at(-1);
        return { ...s, track: [...s.track, p], distance: s.distance + (last ? distanceM(last, p) : 0), elapsed: i * 10_000, resumedAt: Date.now() };
      });
    }, 1000);
  };

  const finish = async () => {
    if (!state) return;
    stopWatch();
    wake.current?.release?.();
    const measured = Math.round((state.elapsed + (state.resumedAt ? Date.now() - state.resumedAt : 0)) / 1000);
    // Simulated runs use synthetic timestamps, so their duration is the track's own time span.
    const duration = state.simulated && state.track.length > 1 ? Math.round((state.track.at(-1)!.t - state.track[0].t) / 1000) : measured;
    const body = {
      started_at: new Date(state.track[0]?.t ?? state.startedAt).toISOString(),
      duration_s: duration,
      track: state.track.map((p) => ({ lat: p.lat, lng: p.lng, t: p.t, ...(p.acc != null ? { acc: p.acc } : {}) })),
      is_commute: state.commute,
      run_id: state.runId,
      client_id: `${state.startedAt}`,
    };
    setBusy(true);
    try {
      const r = await api.post('/activities', body);
      setSummary({ ...r, run_id: state.runId });
      setState(null);
      toast(t('rec.saved'));
      reloadHistory();
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        write(PENDING_KEY, [...read<any[]>(PENDING_KEY, []), body]);
        setState(null);
        toast(t('rec.offlineQueued'));
      } else {
        toast(errorText(e), 'error');
        if (e instanceof ApiError && e.code === 'activity_too_short') setState(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const pace = state && state.distance > 50 ? elapsed / 1000 / (state.distance / 1000) : null;
  const curPace = useMemo(() => {
    const tr = state?.track ?? [];
    if (tr.length < 3) return null;
    const a = tr[Math.max(0, tr.length - 6)];
    const b = tr[tr.length - 1];
    const d = distanceM(a, b);
    return d > 10 ? (b.t - a.t) / 1000 / (d / 1000) : null;
  }, [state?.track]);
  const line = useMemo(() => (state?.track.length ? [{ points: state.track.map((p) => [p.lat, p.lng] as [number, number]) }] : []), [state?.track]);
  const me = state?.track.at(-1) ?? null;

  if (summary) {
    return (
      <main className="screen no-tab">
        <NavBar title={t('rec.summary')} right={<button className="btn plain" onClick={() => setSummary(null)}>{t('common.done')}</button>} />
        <ActivitySummary a={summary} />
        {summary.run_id && <Link className="btn block" style={{ background: '#8a5a00' }} to={`/eco/log?run=${summary.run_id}&activity=${summary.id}`}><Icon name="leaf" size={20} /> {t('rec.logPlog')}</Link>}
        <Link className="btn block gray" to={`/activities/${summary.id}`}>{t('common.view')}</Link>
      </main>
    );
  }

  return (
    <main className="screen">
      <LargeTitle title={t('rec.title')} right={<Link className="icon-btn" to="/" aria-label={t('common.close')}><Icon name="close" size={20} /></Link>} />
      <MapView className="map mid" lines={line} me={me} center={me ?? undefined} fit={!me && line.length > 0} label={t('rec.title')} />
      <section className="card" aria-live="polite">
        <div className="tracker-main">
          <div className="huge-num">{fmtKm(state?.distance ?? 0)}</div>
          <div className="sub">{t('rec.distance')}, {t('common.km')}</div>
        </div>
        <div className="tracker-stats">
          <div><div className="v">{fmtDuration(elapsed / 1000)}</div><div className="footnote">{t('rec.time')}</div></div>
          <div><div className="v">{fmtPace(recording ? curPace ?? pace : pace)}</div><div className="footnote">{recording ? t('rec.current') : t('rec.pace')}{t('common.perKm')}</div></div>
        </div>
        <p className="footnote center">
          {gps === 'denied' ? <span className="danger">{t('rec.gpsDenied')}</span> : gps === 'waiting' ? t('rec.gpsWaiting') : gps === 'weak' ? <span className="orange">{t('rec.gpsWeak')}</span> : gps === 'ok' ? t('rec.gpsOk') : t('rec.keepOpen')}
        </p>
        {!state ? (
          <div className="col" style={{ gap: 8 }}>
            <button className="btn block" style={{ minHeight: 60, fontSize: 20 }} onClick={start}><Icon name="play" size={22} fill /> {t('rec.start')}</button>
            {simEnabled && <button className="btn block gray sm" onClick={simulate}>{t('rec.sim')}</button>}
          </div>
        ) : (
          <div className="btn-row">
            {recording ? (
              <button className="btn orange" onClick={pause}><Icon name="pause" size={20} /> {t('rec.pause')}</button>
            ) : (
              <button className="btn" onClick={resume}><Icon name="play" size={20} fill /> {t('rec.resume')}</button>
            )}
            <button className="btn danger" disabled={busy} onClick={finish} style={{ background: '#d70015', color: '#fff' }}><Icon name="stop" size={20} fill /> {t('rec.finish')}</button>
          </div>
        )}
        {state && !recording && <button className="btn plain danger" style={{ color: 'var(--red)' }} onClick={() => setDiscard(true)}>{t('rec.discard')}</button>}
      </section>

      {state && (
        <ul className="field-list">
          <li className="field">
            <span className="lbl grow" style={{ width: 'auto' }}>{t('rec.commute')}</span>
            <Switch checked={state.commute} onChange={(v) => setState((s) => (s ? { ...s, commute: v } : s))} label={t('rec.commute')} />
          </li>
          {todayRuns.length > 0 && (
            <li className="field">
              <label htmlFor="rec-run">{t('rec.linkRun')}</label>
              <select id="rec-run" value={state.runId ?? ''} onChange={(e) => setState((s) => (s ? { ...s, runId: e.target.value || null } : s))}>
                <option value="">{t('rec.noRun')}</option>
                {todayRuns.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </select>
            </li>
          )}
        </ul>
      )}

      {pending > 0 && <p className="badge orange" style={{ alignSelf: 'center' }}>{t('rec.pending', { n: pending })}</p>}

      <List label={t('rec.history')}>
        {history?.length ? history.slice(0, 20).map((a) => (
          <Row
            key={a.id}
            to={`/activities/${a.id}`}
            icon={a.is_commute ? 'bolt' : 'runner'}
            tile={a.flagged ? '#8e8e93' : a.is_commute ? '#0066cc' : 'var(--accent-bg)'}
            title={`${fmtKm(a.distance_m, 1)} ${t('common.km')} · ${fmtDuration(a.duration_s)}`}
            subtitle={`${fmtWhen(a.started_at, lang, t)}${a.run_title ? ` · ${a.run_title}` : ''}`}
            value={a.flagged ? <span className="badge red">{t('adm.flagged')}</span> : `${fmtPace(a.avg_pace_s)}${t('common.perKm')}`}
          />
        )) : <Empty icon="runner" text="—" />}
      </List>

      <Confirm open={discard} onClose={() => setDiscard(false)} danger text={t('rec.discardConfirm')} confirmLabel={t('rec.discard')} onConfirm={() => { stopWatch(); setState(null); nav('/record'); }} />
    </main>
  );
}

function ActivitySummary({ a }: { a: any }) {
  const { t } = useApp();
  return (
    <>
      <section className="card">
        <div className="grid3">
          <div className="stat"><span className="v">{fmtKm(a.distance_m)}</span><span className="l">{t('common.km')}</span></div>
          <div className="stat"><span className="v">{fmtDuration(a.duration_s)}</span><span className="l">{t('rec.time')}</span></div>
          <div className="stat"><span className="v">{fmtPace(a.avg_pace_s)}</span><span className="l">{t('rec.pace')}</span></div>
        </div>
        {a.flagged ? <p className="badge red">{t('rec.flagged', { reason: a.flag_reason })}</p> : a.points != null && a.points > 0 && <p className="badge green" style={{ alignSelf: 'flex-start', fontSize: 15, padding: '6px 10px' }}>{t('rec.points', { n: a.points })}</p>}
      </section>
      {a.splits?.length > 0 && (
        <List label={t('rec.splits')}>
          {a.splits.map((s: any) => <Row key={s.km} title={`${s.km} ${t('common.km')}`} value={`${fmtPace(s.sec)}${t('common.perKm')}`} />)}
        </List>
      )}
    </>
  );
}

export function ActivityDetail() {
  const { id } = useParams();
  const { t, lang, me, toast, errorText } = useApp();
  const nav = useNavigate();
  const [a, loading, error, reload] = useLoad<any>(() => api.get(`/activities/${id}`), [id]);
  const [del, setDel] = useState(false);
  const line = useMemo(() => (a?.track?.length ? [{ points: a.track.map((p: any) => [p.lat, p.lng]) }] : []), [a]);
  if (loading) return <main className="screen no-tab"><NavBar back /><Loading /></main>;
  if (error || !a) return <main className="screen no-tab"><NavBar back /><ErrorBox error={error} retry={reload} /></main>;
  const own = a.user_id === me?.id;
  return (
    <main className="screen no-tab tight">
      <NavBar back title={fmtDateTime(a.started_at, lang)} />
      {!own && <Row to={`/users/${a.user_id}`} title={a.name} leading={<span />} />}
      {line.length > 0 && <MapView className="map mid" lines={line} fit label={t('act.title')} />}
      <div className="row-flex wrap" style={{ gap: 6 }}>
        {a.is_commute && <span className="badge blue">{t('act.commute')}</span>}
        {a.source !== 'app' && <span className="badge">{a.source}</span>}
      </div>
      <ActivitySummary a={a} />
      {own && <button className="btn block danger" onClick={() => setDel(true)}><Icon name="trash" size={18} /> {t('act.delete')}</button>}
      <Confirm
        open={del}
        onClose={() => setDel(false)}
        danger
        text={t('act.deleteConfirm')}
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          try {
            await api.del(`/activities/${a.id}`);
            nav('/record', { replace: true });
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      />
    </main>
  );
}
