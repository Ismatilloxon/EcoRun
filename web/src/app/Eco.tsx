import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { approxPosition, getPosition, TASHKENT, type LatLng } from '../lib/geo.ts';
import { fmtDateTime, fmtNum } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Chips, Empty, List, Loading, NavBar, PhotoInput, Progress, Row, Sheet, Stepper } from '../ui/ui.tsx';
import { MapView } from '../components/MapView.tsx';

const WASTE = ['plastic', 'paper', 'glass', 'metal', 'mixed'] as const;

export function EcoLog() {
  const { t, toast, errorText } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [meta] = useLoad<any>(() => api.get('/meta'));
  const [mine] = useLoad<any>(() => api.get('/runs/mine'));
  const [runId, setRunId] = useState<string>(sp.get('run') ?? '');
  const [small, setSmall] = useState(1);
  const [large, setLarge] = useState(0);
  const [waste, setWaste] = useState<string[]>(['plastic']);
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const spotId = sp.get('spot');

  useEffect(() => {
    getPosition().then((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude })).catch(() => toast(t('err.geo_unavailable'), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eligible = useMemo(
    () => [...(mine?.upcoming ?? []), ...(mine?.past ?? [])].filter((r: any) => r.my_status === 'checked_in' && Date.now() - new Date(r.start_at).getTime() < 24 * 3600_000 && Date.now() > new Date(r.start_at).getTime()),
    [mine],
  );
  const estimate = meta ? Math.round((small + large * meta.points.plogging_large_bag_multiplier) * meta.points.plogging_bag) : 0;

  const submit = async () => {
    if (!pos || !after) return;
    setBusy(true);
    try {
      const r = await api.post('/eco/actions', {
        run_id: runId || null,
        activity_id: sp.get('activity') || null,
        dirty_spot_id: spotId || null,
        bags_small: small,
        bags_large: large,
        waste_types: waste,
        photo_before_url: before,
        photo_after_url: after,
        lat: pos.lat,
        lng: pos.lng,
      });
      toast(r.status === 'approved' ? t('eco.approvedNow', { n: r.points }) : t('eco.submitted'));
      nav('/eco/history', { replace: true });
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('eco.logTitle')} />
      <ul className="field-list">
        <li className="field">
          <label htmlFor="eco-run">{t('eco.forRun')}</label>
          <select id="eco-run" value={runId} onChange={(e) => setRunId(e.target.value)}>
            <option value="">{t('eco.solo')}</option>
            {eligible.map((r: any) => <option key={r.id} value={r.id}>{r.title}</option>)}
            {runId && !eligible.some((r: any) => r.id === runId) && <option value={runId}>{runId.slice(0, 8)}</option>}
          </select>
        </li>
        <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('eco.bagsSmall')}</span><Stepper value={small} onChange={setSmall} label={t('eco.bagsSmall')} /></li>
        <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('eco.bagsLarge')}</span><Stepper value={large} onChange={setLarge} label={t('eco.bagsLarge')} /></li>
      </ul>
      <section className="col" style={{ gap: 8 }}>
        <h2 className="group-label">{t('eco.waste')}</h2>
        <Chips value={waste} multi onChange={setWaste} options={WASTE.map((w) => ({ value: w, label: t(`eco.w.${w}`) }))} wrap label={t('eco.waste')} />
      </section>
      <div className="grid2">
        <PhotoInput value={before} onChange={setBefore} label={t('eco.before')} />
        <PhotoInput value={after} onChange={setAfter} label={t('eco.after')} required />
      </div>
      <p className="footnote row-flex" style={{ gap: 6 }}>
        <Icon name={pos ? 'checkCircle' : 'locate'} size={16} className={pos ? 'accent' : undefined} />
        {pos ? t('eco.location') : t('eco.locationWaiting')}
      </p>
      <p className="footnote">{t('eco.verifyNote')}</p>
      <section className="card pad-sm" style={{ background: 'var(--accent-tint)' }}>
        <span className="headline accent">{t('eco.estimate', { n: estimate })}</span>
      </section>
      <button className="btn block" disabled={busy || !after || !pos || small + large < 1 || !waste.length} onClick={submit}>{t('eco.submit')}</button>
    </main>
  );
}

export function Spots() {
  const { t, lang, me, toast, errorText } = useApp();
  const nav = useNavigate();
  const [spots, loading, , reload] = useLoad<any[]>(() => api.get('/eco/spots'), [me?.id]);
  const [center, setCenter] = useState<LatLng>(TASHKENT);
  const [sel, setSel] = useState<any>(null);
  const [report, setReport] = useState<LatLng | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    approxPosition().then((p) => p && setCenter(p));
  }, []);

  const markers = useMemo(
    () => [
      ...(spots ?? []).map((s) => ({ id: s.id, lat: s.lat, lng: s.lng, kind: `spot ${s.status === 'cleaned' ? 'cleaned' : ''}`, title: s.description ?? t('eco.spots'), onClick: () => setSel(s) })),
      ...(report ? [{ id: 'new', lat: report.lat, lng: report.lng, kind: 'plogging', title: t('eco.reportSpot') }] : []),
    ],
    [spots, report, t],
  );

  const statusLabel = (s: string) => t(s === 'cleaned' ? 'eco.spotCleaned' : s === 'scheduled' ? 'eco.spotScheduled' : s === 'reported' ? 'eco.spotReported' : 'eco.spotApproved');

  const send = async () => {
    if (!report || !photo) return;
    setBusy(true);
    try {
      await api.post('/eco/spots', { lat: report.lat, lng: report.lng, photo_url: photo, description: desc.trim() || null });
      toast(t('eco.spotSent'));
      setReport(null);
      setPhoto(null);
      setDesc('');
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('eco.spots')} />
      <MapView className="map tall" center={center} markers={markers} onMapClick={me ? (p) => setReport(p) : undefined} label={t('eco.spots')} />
      {me ? (
        <div className="btn-row">
          <button className="btn" onClick={async () => { try { const p = await getPosition(); setReport({ lat: p.coords.latitude, lng: p.coords.longitude }); } catch { toast(t('err.geo_unavailable'), 'error'); } }}>
            <Icon name="locate" size={18} /> {t('eco.useMyLocation')}
          </button>
          <Link className="btn tinted" to="/eco/log"><Icon name="leaf" size={18} /> {t('eco.logTitle')}</Link>
        </div>
      ) : (
        <Link className="btn block" to="/welcome">{t('common.signInToContinue')}</Link>
      )}
      <p className="footnote">{t('eco.spotHint')}</p>
      {loading ? <Loading /> : (
        <List>
          {(spots ?? []).map((s) => (
            <Row key={s.id} onClick={() => setSel(s)} icon="pin" tile={s.status === 'cleaned' ? '#34c759' : '#d70015'} title={s.description ?? '—'} subtitle={`${statusLabel(s.status)} · ${fmtDateTime(s.created_at, lang)}`} chevron />
          ))}
        </List>
      )}

      <Sheet open={Boolean(sel)} onClose={() => setSel(null)} title={sel ? statusLabel(sel.status) : ''}>
        {sel && (
          <>
            {sel.photo_url && <img className="cover" src={assetUrl(sel.photo_url)} alt="" />}
            <p>{sel.description}</p>
            {me && ['approved', 'reported'].includes(sel.status) && (
              <div className="btn-row">
                <button className="btn" onClick={() => nav(`/runs/new?spot=${sel.id}&lat=${sel.lat}&lng=${sel.lng}`)}>{t('eco.spotPlan')}</button>
                <button className="btn tinted" onClick={() => nav(`/eco/log?spot=${sel.id}`)}>{t('eco.cleanSpot')}</button>
              </div>
            )}
            {sel.run_id && <Link className="btn block gray" to={`/runs/${sel.run_id}`}>{t('eco.spotScheduled')}</Link>}
          </>
        )}
      </Sheet>

      <Sheet open={Boolean(report)} onClose={() => setReport(null)} title={t('eco.reportSpot')}>
        <PhotoInput value={photo} onChange={setPhoto} label={t('eco.addPhoto')} required />
        <ul className="field-list">
          <li className="field stack">
            <label htmlFor="spot-desc">{t('eco.spotDesc')}</label>
            <textarea id="spot-desc" maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </li>
        </ul>
        <button className="btn block" disabled={!photo || busy} onClick={send}>{t('common.send')}</button>
      </Sheet>
    </main>
  );
}

export function EcoHistory() {
  const { t, lang } = useApp();
  const [items, loading] = useLoad<any[]>(() => api.get('/eco/actions/mine'));
  return (
    <main className="screen no-tab tight">
      <NavBar back="/profile" title={t('eco.history')} right={<Link className="icon-btn accent" to="/eco/log" aria-label={t('eco.logTitle')}><Icon name="plus" size={20} /></Link>} />
      {loading ? <Loading /> : !items?.length ? <Empty icon="leaf" text={t('eco.empty')} action={<Link className="btn sm" to="/eco/log">{t('eco.logTitle')}</Link>} /> : (
        <List>
          {items.map((e) => (
            <Row
              key={e.id}
              leading={e.photo_after_url ? <img src={assetUrl(e.photo_after_url)} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} /> : undefined}
              icon="leaf"
              tile="#8a5a00"
              title={`${e.bags_small + e.bags_large} ${t('impact.bags')} · ${e.waste_types.map((w: string) => t(`eco.w.${w}`)).join(', ')}`}
              subtitle={`${e.run_title ?? t('eco.solo')} · ${fmtDateTime(e.created_at, lang)}${e.review_reason && e.status === 'rejected' ? ` · ${e.review_reason}` : ''}`}
              value={<span className={`badge ${e.status === 'approved' ? 'green' : e.status === 'rejected' ? 'red' : 'orange'}`}>{t(`eco.status.${e.status}`)}{e.points ? ` · ${e.points}` : ''}</span>}
            />
          ))}
        </List>
      )}
    </main>
  );
}

export function Donate() {
  const { t, lang, me, refreshMe, toast, errorText } = useApp();
  const [projects, loading, , reload] = useLoad<any[]>(() => api.get('/eco/donations'));
  const [busy, setBusy] = useState(false);
  return (
    <main className="screen no-tab tight">
      <NavBar back="/profile" title={t('eco.donate')} />
      <section className="card pad-sm"><span className="sub">{t('rw.balance')}</span><span className="big-num accent">{fmtNum(me?.points.balance ?? 0, lang)}</span></section>
      {loading ? <Loading /> : projects?.map((p) => (
        <section key={p.id} className="card">
          <span className="tile lg" style={{ background: 'var(--accent-bg)' }}><Icon name="tree" size={24} /></span>
          <h2 className="title3">{p.title}</h2>
          <p className="muted">{p.description}</p>
          {p.sponsor && <span className="footnote">{t('ch.sponsor', { name: p.sponsor })}</span>}
          <Progress value={p.raised} max={p.points_goal} label={p.title} />
          <span className="footnote">{t('eco.raised', { raised: fmtNum(p.raised, lang), goal: fmtNum(p.points_goal, lang) })} · {Math.floor(p.raised / p.points_per_unit)} {p.unit_label}</span>
          <div className="btn-row">
            {[p.points_per_unit / 5, p.points_per_unit].map((n: number) => (
              <button
                key={n}
                className="btn tinted"
                disabled={busy || (me?.points.balance ?? 0) < n}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post(`/eco/donations/${p.id}`, { points: n });
                    toast(t('eco.donated'));
                    reload();
                    refreshMe();
                  } catch (e) {
                    toast(errorText(e), 'error');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('eco.donateBtn', { n })}
              </button>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
