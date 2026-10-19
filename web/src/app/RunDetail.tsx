import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, API, assetUrl, onRealtime, joinRoom } from '../api.ts';
import { getPosition } from '../lib/geo.ts';
import { fmtDateTime, fmtRelative, fmtWhen } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Avatar, Confirm, Empty, ErrorBox, List, Loading, NavBar, Row, Sheet, TypeBadge } from '../ui/ui.tsx';
import { MapView } from '../components/MapView.tsx';
import { QrCode, QrScanner } from '../components/Qr.tsx';
import { ReportSheet } from './Social.tsx';

export const checkinQrValue = (runId: string, code: string) => `ECORUN:CHECKIN:${runId}:${code}`;

export function RunDetail() {
  const { id } = useParams();
  const { t, lang, me, toast, errorText } = useApp();
  const nav = useNavigate();
  const [run, loading, error, reload] = useLoad<any>(() => api.get(`/runs/${id}`), [id, me?.id]);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [qrOpen, setQrOpen] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toReview, setToReview] = useState<any[]>([]);

  useEffect(() => {
    if (!run?.can_manage) return;
    joinRoom(run.id);
    api.get('/eco/actions/to-review').then((r) => setToReview(r.filter((x: any) => x.run_id === run.id))).catch(() => {});
    return onRealtime((m) => m.type === 'checkin' && m.runId === run.id && reload());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.can_manage, run?.id]);

  const markers = useMemo(() => (run ? [{ id: 'meet', lat: run.meeting_lat, lng: run.meeting_lng, kind: run.type, title: run.meeting_address ?? t('run.meeting') }] : []), [run, t]);
  const lines = useMemo(() => (run?.route?.length ? [{ points: run.route }] : []), [run]);

  if (loading && !run) return <main className="screen no-tab"><NavBar back /><Loading /></main>;
  if (error) return <main className="screen no-tab"><NavBar back /><ErrorBox error={error} retry={reload} /></main>;
  if (!run) return null;

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok);
      reload();
      return r;
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const join = () => act(() => api.post(`/runs/${run.id}/join`));
  const leave = () => act(() => api.post(`/runs/${run.id}/leave`));
  const checkinGeo = async () => {
    setBusy(true);
    try {
      const p = await getPosition();
      const r = await api.post(`/runs/${run.id}/checkin`, { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      toast(t('run.checkinOk', { n: r.points }));
      navigator.vibrate?.([20, 40, 20]);
      reload();
    } catch (e: any) {
      toast(e?.code ? errorText(e) : t('err.geo_unavailable'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const checkinCode = (c: string) =>
    act(async () => {
      const r = await api.post(`/runs/${run.id}/checkin`, { code: c });
      toast(t('run.checkinOk', { n: r.points }));
      setCodeOpen(false);
      setScan(false);
    });
  const onScan = (text: string) => {
    const m = text.match(/^ECORUN:CHECKIN:([0-9a-f-]{36}):([A-Z0-9]{4,12})$/);
    if (!m || m[1] !== run.id) {
      toast(t('err.invalid_code'), 'error');
      setScan(false);
      return;
    }
    checkinCode(m[2]);
  };

  const startMs = new Date(run.start_at).getTime();
  const end = new Date(startMs + 90 * 60_000);
  const gcal = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(run.title)}&dates=${new Date(startMs).toISOString().replace(/[-:]|\.\d{3}/g, '')}/${end.toISOString().replace(/[-:]|\.\d{3}/g, '')}&location=${encodeURIComponent(run.meeting_address ?? `${run.meeting_lat},${run.meeting_lng}`)}&details=${encodeURIComponent(`${location.origin}/runs/${run.id}`)}`;
  const share = async () => {
    const url = `${location.origin}/runs/${run.id}`;
    if (navigator.share) navigator.share({ title: run.title, text: `${run.title} · ${fmtWhen(run.start_at, lang, t)}`, url }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(url);
      toast(t('common.copied'));
    }
  };

  const status: string | null = run.my_status;
  const isGoing = status === 'joined' || status === 'checked_in';
  const spotsLeft = run.capacity ? run.capacity - run.participants_count : null;
  const pending = run.participants.filter((p: any) => p.status === 'pending');
  const waitlist = run.participants.filter((p: any) => p.status === 'waitlist');
  const attendees = run.participants.filter((p: any) => ['joined', 'checked_in', 'no_show'].includes(p.status));
  const visible = run.participants.filter((p: any) => ['joined', 'checked_in'].includes(p.status));
  const isPast = Date.now() > startMs + 3 * 3600_000;

  return (
    <main className="screen no-tab tight">
      <NavBar
        back
        right={
          <div className="row-flex" style={{ gap: 8 }}>
            <button className="icon-btn" aria-label={t('run.share')} onClick={share}><Icon name="share" size={20} /></button>
            {me && !run.can_manage && <button className="icon-btn" aria-label={t('run.report')} onClick={() => setReportOpen(true)}><Icon name="flag" size={20} /></button>}
          </div>
        }
      />
      {run.cover_url && <img className="cover" src={assetUrl(run.cover_url)} alt="" />}
      <div className="col" style={{ gap: 8, padding: '0 4px' }}>
        <div className="row-flex wrap" style={{ gap: 6 }}>
          <TypeBadge type={run.type} />
          {run.women_only && <span className="badge purple">{t('runs.womenOnly')}</span>}
          {run.recurrence_rule && <span className="badge">{t('runs.weekly')}</span>}
          {run.requires_approval && <span className="badge blue">{t('runs.approval')}</span>}
          {run.status === 'cancelled' && <span className="badge red">{t('run.cancelled')}</span>}
          {run.status === 'completed' && <span className="badge">{t('run.completed')}</span>}
          {run.rating?.n > 0 && <span className="badge orange">{t('run.rating', { avg: run.rating.avg, n: run.rating.n })}</span>}
        </div>
        <h1 style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700 }}>{run.title}</h1>
        <p className="muted">{fmtWhen(run.start_at, lang, t)} · {fmtRelative(run.start_at, lang)}</p>
      </div>

      <MapView className="map small" markers={markers} lines={lines} fit label={t('run.meeting')} />

      {/* Primary actions */}
      {run.status === 'scheduled' && (
        <section className="card pad-sm" aria-live="polite">
          {!me ? (
            <Link className="btn block" to="/welcome">{t('run.signInToJoin')}</Link>
          ) : run.can_manage && run.organizer_id === me.id ? (
            <div className="row-flex"><Icon name="flag" /><span className="headline">{t('run.organizerYou')}</span></div>
          ) : !status || ['left', 'rejected', 'no_show'].includes(status) ? (
            <button className="btn block" disabled={busy || status === 'rejected'} onClick={join}>
              {run.requires_approval ? t('run.request') : spotsLeft != null && spotsLeft <= 0 ? t('run.joinWaitlist') : t('run.join')}
            </button>
          ) : (
            <div className="row-flex" style={{ justifyContent: 'space-between' }}>
              <span className="row-flex headline" style={{ color: status === 'checked_in' ? 'var(--accent)' : status === 'joined' ? 'var(--accent)' : 'var(--orange)' }}>
                <Icon name={status === 'checked_in' ? 'checkCircle' : status === 'joined' ? 'check' : 'clock'} />
                {status === 'checked_in' ? t('run.checkedIn') : status === 'joined' ? t('run.going') : status === 'waitlist' ? t('run.waitlisted') : t('run.requested')}
              </span>
              {status !== 'checked_in' && <button className="btn sm danger" disabled={busy} onClick={leave}>{t('run.leave')}</button>}
            </div>
          )}

          {me && status === 'joined' && (
            run.checkin_open ? (
              <div className="col" style={{ gap: 8 }}>
                <button className="btn block orange" disabled={busy} onClick={checkinGeo}><Icon name="locate" size={20} /> {t('run.checkinGeo')}</button>
                <div className="btn-row">
                  <button className="btn tinted" onClick={() => setScan(true)}><Icon name="scan" size={18} /> QR</button>
                  <button className="btn gray" onClick={() => setCodeOpen(true)}>{t('run.checkinCode')}</button>
                </div>
              </div>
            ) : (
              <p className="footnote">{t('run.checkinHint', { r: run.checkin_radius_m })}</p>
            )
          )}

          {me && (isGoing || run.can_manage || status === 'waitlist') && (
            <div className="btn-row">
              <Link className="btn tinted" to={`/runs/${run.id}/chat`}><Icon name="chat" size={18} /> {t('run.chat')}</Link>
              <button className="btn gray" onClick={() => setCalOpen(true)}><Icon name="calendar" size={18} /> {t('run.calendar')}</button>
            </div>
          )}
        </section>
      )}

      {status === 'checked_in' && run.type === 'plogging' && (
        <Link className="btn block" style={{ background: '#8a5a00' }} to={`/eco/log?run=${run.id}`}><Icon name="leaf" size={20} /> {t('run.logPlogging')}</Link>
      )}
      {status === 'checked_in' && Date.now() > startMs && (
        <section className="card pad-sm" style={{ alignItems: 'center' }}>
          <span className="sub">{run.my_rating ? t('run.thanks') : t('run.rate')}</span>
          <div className="row-flex" role="radiogroup" aria-label={t('run.rate')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                className="link"
                role="radio"
                aria-checked={run.my_rating === n}
                aria-label={`${n}`}
                style={{ color: (run.my_rating ?? 0) >= n ? 'var(--orange)' : 'var(--chevron)', minWidth: 44, minHeight: 44 }}
                onClick={() => act(() => api.post(`/runs/${run.id}/rate`, { rating: n }))}
              >
                <Icon name="star" size={28} fill={(run.my_rating ?? 0) >= n} />
              </button>
            ))}
          </div>
        </section>
      )}

      <List>
        <Row icon="pin" tile="#d70015" title={t('run.meeting')} subtitle={run.meeting_address ?? `${run.meeting_lat.toFixed(5)}, ${run.meeting_lng.toFixed(5)}`} />
        {run.distance_km && <Row icon="road" tile="#0066cc" title={t('run.distance')} value={`${run.distance_km} ${t('common.km')}`} />}
        {run.pace_groups?.length > 0 && <Row icon="clock" tile="#c93400" title={t('run.pace')} value={run.pace_groups.map((p: string) => `${p}${t('common.perKm')}`).join(' · ')} />}
        <Row icon="bolt" tile="#7d3cc9" title={t('run.level')} value={t(`level.${run.level ?? 'all'}`)} />
        <Row icon="people" tile="var(--accent-bg)" title={t('run.capacity')} value={`${run.participants_count} / ${run.capacity ?? '∞'}${run.waitlist_count ? ` · ${t('run.waitlist')} ${run.waitlist_count}` : ''}`} />
        <Row to={`/users/${run.organizer.id}`} leading={<Avatar src={run.organizer.photo_url} name={run.organizer.name} size={30} />} title={run.organizer.name} subtitle={t('run.organizer')} />
        {run.club && <Row to={`/clubs/${run.club.id}`} icon="flag" tile="#0066cc" title={run.club.name} subtitle={run.club.verified ? t('cl.verified') : t('run.club')} />}
      </List>

      {run.type === 'plogging' && (run.plogging_supplies || run.plogging_dropoff) && (
        <List label={t('run.plogging')}>
          {run.plogging_supplies && <Row icon="bag" tile="#8a5a00" title={t('run.supplies')} subtitle={run.plogging_supplies} />}
          {run.plogging_dropoff && <Row icon="leaf" tile="var(--accent-bg)" title={t('run.dropoff')} subtitle={run.plogging_dropoff} />}
        </List>
      )}

      {run.description && (
        <section className="card pad-sm">
          <h2 className="group-label" style={{ padding: 0 }}>{t('run.description')}</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{run.description}</p>
        </section>
      )}

      {visible.length > 0 && !run.can_manage && (
        <section className="section">
          <h2 className="group-label">{t('run.participants')} · {visible.length}</h2>
          <div className="card pad-sm" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {visible.map((p: any) => (
              <Link key={p.id} to={`/users/${p.id}`} aria-label={p.name} title={p.name}><Avatar src={p.photo_url} name={p.name} size={40} /></Link>
            ))}
          </div>
        </section>
      )}

      {/* Organizer tools */}
      {run.can_manage && (
        <>
          <h2 className="title2" style={{ padding: '8px 4px 0' }}>{t('run.manage')}</h2>
          <List>
            <Row icon="qr" tile="#000" title={t('run.qrTitle')} onClick={() => setQrOpen(true)} chevron />
            <Row icon="edit" tile="#0066cc" title={t('run.edit')} to={`/runs/${run.id}/edit`} />
            <Row icon="download" tile="#7d3cc9" title={t('run.exportCsv')} onClick={() => api.download(`/runs/${run.id}/attendance?format=csv`, `attendance-${run.id.slice(0, 8)}.csv`).catch((e) => toast(errorText(e), 'error'))} chevron />
            {run.status === 'scheduled' && <Row icon="close" tile="#d70015" title={t('run.cancel')} danger onClick={() => setCancelOpen(true)} chevron />}
          </List>

          {pending.length > 0 && (
            <List label={t('run.pendingRequests')}>
              {pending.map((p: any) => (
                <Row
                  key={p.id}
                  leading={<Avatar src={p.photo_url} name={p.name} size={32} />}
                  title={p.name}
                  trailing={
                    <span className="row-flex" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => act(() => api.post(`/runs/${run.id}/participants/${p.id}/approve`))}>{t('run.approve')}</button>
                      <button className="btn sm danger" onClick={() => act(() => api.post(`/runs/${run.id}/participants/${p.id}/reject`))}>{t('run.reject')}</button>
                    </span>
                  }
                />
              ))}
            </List>
          )}

          {toReview.length > 0 && (
            <List label={t('run.ecoToReview')}>
              {toReview.map((e) => (
                <Row
                  key={e.id}
                  leading={e.photo_after_url ? <img src={assetUrl(e.photo_after_url)} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover' }} /> : <Avatar name={e.user.name} size={36} />}
                  title={e.user.name}
                  subtitle={`${e.bags_small} S + ${e.bags_large} L · ${e.waste_types.map((w: string) => t(`eco.w.${w}`)).join(', ')}`}
                  trailing={
                    <span className="row-flex" style={{ gap: 6 }}>
                      <button className="btn sm" onClick={() => act(async () => { await api.post(`/eco/actions/${e.id}/review`, { approve: true }); setToReview((x) => x.filter((y) => y.id !== e.id)); })}>{t('run.approve')}</button>
                      <button className="btn sm danger" onClick={() => act(async () => { await api.post(`/eco/actions/${e.id}/review`, { approve: false, reason: 'Organizer' }); setToReview((x) => x.filter((y) => y.id !== e.id)); })}>{t('run.reject')}</button>
                    </span>
                  }
                />
              ))}
            </List>
          )}

          <List label={`${t('run.attendance')} · ${run.checked_in_count}/${attendees.length}`}>
            {attendees.length ? attendees.map((p: any) => (
              <Row
                key={p.id}
                leading={<Avatar src={p.photo_url} name={p.name} size={32} />}
                title={p.name}
                subtitle={p.check_in_at ? fmtDateTime(p.check_in_at, lang) : t(`status.${p.status}`)}
                trailing={
                  p.status === 'checked_in' ? <Icon name="checkCircle" className="accent" /> : p.id === run.organizer_id ? null : (
                    <span className="row-flex" style={{ gap: 6 }}>
                      <button className="btn sm tinted" onClick={() => act(() => api.post(`/runs/${run.id}/participants/${p.id}/checkin`))}>{t('run.markCheckin')}</button>
                      {isPast && p.status === 'joined' && <button className="btn sm gray" onClick={() => act(() => api.post(`/runs/${run.id}/participants/${p.id}/no_show`))}>{t('run.noShow')}</button>}
                    </span>
                  )
                }
              />
            )) : <Empty text="—" />}
          </List>
          {waitlist.length > 0 && (
            <List label={t('run.waitlist')}>
              {waitlist.map((p: any) => <Row key={p.id} leading={<Avatar src={p.photo_url} name={p.name} size={32} />} title={p.name} />)}
            </List>
          )}
        </>
      )}

      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title={t('run.qrTitle')}>
        {run.checkin_code && <QrCode value={checkinQrValue(run.id, run.checkin_code)} label={t('run.qrTitle')} />}
        <p className="code-big">{run.checkin_code}</p>
        <p className="footnote center">{t('run.qrHint', { code: run.checkin_code })}</p>
      </Sheet>

      <Sheet open={scan} onClose={() => setScan(false)} title={t('run.checkinQr')}>
        {scan && <QrScanner onResult={onScan} onClose={() => setScan(false)} />}
      </Sheet>

      <Sheet open={codeOpen} onClose={() => setCodeOpen(false)} title={t('run.checkinCode')}>
        <form className="col" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); checkinCode(code); }}>
          <label className="sr-only" htmlFor="ci-code">{t('run.checkinCode')}</label>
          <input id="ci-code" className="input-big otp" value={code} maxLength={6} autoCapitalize="characters" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoFocus />
          <button className="btn block" disabled={code.length < 4 || busy}>{t('run.checkin')}</button>
        </form>
      </Sheet>

      <Sheet open={calOpen} onClose={() => setCalOpen(false)} title={t('run.calendar')}>
        <List>
          <Row icon="calendar" tile="#0066cc" title={t('run.google')} onClick={() => window.open(gcal, '_blank', 'noopener')} chevron />
          <Row icon="download" tile="#c93400" title={t('run.ics')} onClick={() => (window.location.href = `${API}/runs/${run.id}/ics`)} chevron />
        </List>
      </Sheet>

      <Confirm
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        danger
        text={t('run.cancelConfirm')}
        confirmLabel={t('run.cancel')}
        onConfirm={() => act(() => api.post(`/runs/${run.id}/cancel`, { series: false }))}
      />
      {run.series_id && run.can_manage && run.status === 'scheduled' && (
        <button className="btn block plain danger" style={{ color: 'var(--red)' }} onClick={() => act(async () => { await api.post(`/runs/${run.id}/cancel`, { series: true }); nav('/runs'); })}>
          {t('run.cancelSeries')}
        </button>
      )}
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} targetType="run" targetId={run.id} />
    </main>
  );
}
