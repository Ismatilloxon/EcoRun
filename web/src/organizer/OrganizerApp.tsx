import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { fmtDateTime, fmtNum } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Empty, Loading, PhotoInput, Sheet } from '../ui/ui.tsx';
import { CabHead, CabinetLayout, Kpi } from '../cabinet.tsx';

function useAct() {
  const { toast, errorText, t } = useApp();
  return async (fn: () => Promise<any>, ok?: boolean) => {
    try {
      const r = await fn();
      if (ok) toast(t('adm.saved'));
      return r;
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
}

function Overview() {
  const { t, lang } = useApp();
  const [d, loading] = useLoad<any>(() => api.get('/organizer/overview'));
  if (loading || !d) return <Loading />;
  const rate = d.totals.joins ? Math.round((d.totals.checkins / d.totals.joins) * 100) : 0;
  const upcoming = d.runs.filter((r: any) => new Date(r.start_at).getTime() > Date.now() - 2 * 3600_000 && r.status === 'scheduled').reverse();
  return (
    <>
      <CabHead title={t('org.overview')}>
        <Link className="btn sm" to="/runs/new"><Icon name="plus" size={16} /> {t('org.newRun')}</Link>
        <Link className="btn sm gray" to="/clubs/new">{t('org.newClub')}</Link>
      </CabHead>
      <div className="kpis">
        <Kpi label={t('org.myClubs')} value={d.clubs.length} />
        <Kpi label={t('org.runs')} value={d.runs.length} />
        <Kpi label={t('org.uniqueRunners')} value={fmtNum(d.totals.unique_runners, lang)} />
        <Kpi label={t('org.attendRate')} value={`${rate}%`} hint={`${d.totals.checkins}/${d.totals.joins}`} />
      </div>
      <h2 className="title3">{t('org.myClubs')}</h2>
      {!d.clubs.length ? <Empty icon="people" text={t('org.noClubs')} action={<Link className="btn sm" to="/clubs/new">{t('org.newClub')}</Link>} /> : (
        <div className="table-box"><table className="tbl">
          <tbody>{d.clubs.map((c: any) => (
            <tr key={c.id}>
              <td><Link to={`/organizer/clubs/${c.id}`}><b>{c.name}</b></Link> {c.verified ? <Icon name="checkCircle" size={14} className="accent" /> : c.verification_requested_at ? <span className="badge orange">{t('org.verifyRequested')}</span> : null}</td>
              <td>{t('cl.members', { n: c.members })}</td><td><span className="badge">{t(`cl.${c.role}`)}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <h2 className="title3">{t('runs.upcoming')}</h2>
      <RunsTable runs={upcoming} />
    </>
  );
}

function RunsTable({ runs }: { runs: any[] }) {
  const { t, lang } = useApp();
  const [att, setAtt] = useState<any>(null);
  const act = useAct();
  if (!runs.length) return <p className="muted">{t('adm.empty')}</p>;
  return (
    <>
      <div className="table-box"><table className="tbl">
        <thead><tr><th>{t('rf.name')}</th><th>{t('rf.date')}</th><th>{t('org.joined')}</th><th>{t('org.checkedIn')}</th><th>{t('org.pending')}</th><th>{t('org.waitlist')}</th><th /></tr></thead>
        <tbody>{runs.map((r) => (
          <tr key={r.id}>
            <td><Link to={`/runs/${r.id}`}>{r.title}</Link><div className="caption">{r.club_name ?? ''}{r.recurrence_rule ? ` · ${t('org.series')}` : ''}{r.status !== 'scheduled' ? ` · ${r.status}` : ''}</div></td>
            <td>{fmtDateTime(r.start_at, lang)}</td><td>{r.joined}{r.capacity ? `/${r.capacity}` : ''}</td><td>{r.checked_in}</td>
            <td>{r.pending > 0 ? <span className="badge orange">{r.pending}</span> : 0}</td><td>{r.waitlist}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn sm gray" onClick={() => act(async () => setAtt({ run: r, rows: await api.get(`/runs/${r.id}/attendance`) }))}>{t('org.attendance')}</button>{' '}
              <button className="btn sm gray" onClick={() => act(() => api.download(`/runs/${r.id}/attendance?format=csv`, `attendance-${r.id.slice(0, 8)}.csv`))}>CSV</button>
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <Sheet open={Boolean(att)} onClose={() => setAtt(null)} title={att?.run.title}>
        {att && (
          <div className="table-box"><table className="tbl">
            <tbody>{att.rows.map((p: any, i: number) => <tr key={i}><td>{p.name}</td><td>{t(`status.${p.status}`)}</td><td>{p.check_in_at ? fmtDateTime(p.check_in_at, lang) : '—'}</td><td className="caption">{p.check_in_method ?? ''}</td></tr>)}</tbody>
          </table></div>
        )}
      </Sheet>
    </>
  );
}

function AllRuns() {
  const { t } = useApp();
  const [d, loading] = useLoad<any>(() => api.get('/organizer/overview'));
  return (
    <>
      <CabHead title={t('org.runs')}><Link className="btn sm" to="/runs/new"><Icon name="plus" size={16} /> {t('org.newRun')}</Link></CabHead>
      {loading ? <Loading /> : <RunsTable runs={d.runs} />}
    </>
  );
}

function ClubManage() {
  const { id } = useParams();
  const { t, lang, me } = useApp();
  const act = useAct();
  const [c, loading, , reload] = useLoad<any>(() => api.get(`/clubs/${id}`), [id]);
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    c && setF({ name: c.name, description: c.description ?? '', schedule_text: c.schedule_text ?? '', address: c.address ?? '', telegram_link: c.telegram_link ?? '', instagram: c.instagram ?? '', logo_url: c.logo_url, cover_url: c.cover_url });
  }, [c]);
  if (loading || !c || !f) return <Loading />;
  const owner = c.my_role === 'owner' || me?.role === 'admin';
  return (
    <>
      <CabHead title={c.name}>
        <Link className="btn sm" to={`/runs/new?club=${c.id}`}><Icon name="plus" size={16} /> {t('org.newRun')}</Link>
        {!c.verified && owner && (c.verification_requested_at ? <span className="badge orange">{t('org.verifyRequested')}</span> : <button className="btn sm gray" onClick={() => act(async () => { await api.post(`/clubs/${c.id}/verification`); reload(); }, true)}>{t('org.requestVerify')}</button>)}
      </CabHead>
      <section className="kpi" style={{ gap: 12 }}>
        <h2 className="title3">{t('org.editClub')}</h2>
        <div className="form-grid">
          <label>{t('cl.name')}<input className="inp" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>{t('cl.schedule')}<input className="inp" value={f.schedule_text} onChange={(e) => setF({ ...f, schedule_text: e.target.value })} /></label>
          <label>{t('rf.address')}<input className="inp" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label>Telegram<input className="inp" placeholder="https://t.me/…" value={f.telegram_link} onChange={(e) => setF({ ...f, telegram_link: e.target.value })} /></label>
          <label>Instagram<input className="inp" value={f.instagram} onChange={(e) => setF({ ...f, instagram: e.target.value })} /></label>
        </div>
        <label className="footnote">{t('cl.about')}<textarea className="inp" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div className="row-flex wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ width: 160 }}><PhotoInput value={f.logo_url} onChange={(u) => setF({ ...f, logo_url: u })} label="Logo" /></div>
          <div style={{ width: 280 }}><PhotoInput value={f.cover_url} onChange={(u) => setF({ ...f, cover_url: u })} label={t('rf.cover')} /></div>
        </div>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={() => act(async () => { await api.patch(`/clubs/${c.id}`, { ...f, telegram_link: f.telegram_link || null, instagram: f.instagram || null }); reload(); }, true)}>{t('common.save')}</button>
      </section>
      <section className="kpi" style={{ gap: 12 }}>
        <h2 className="title3">{t('cl.gallery')}</h2>
        <div className="row-flex wrap">
          {c.photos.map((p: any) => (
            <div key={p.id} style={{ position: 'relative' }}>
              <img src={assetUrl(p.url)} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10 }} />
              <button className="icon-btn" aria-label={t('common.delete')} style={{ position: 'absolute', top: 4, right: 4, width: 32, height: 32 }} onClick={() => act(async () => { await api.del(`/clubs/${c.id}/photos/${p.id}`); reload(); })}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <div style={{ width: 120 }}><PhotoInput value={null} onChange={(u) => u && act(async () => { await api.post(`/clubs/${c.id}/photos`, { url: u }); reload(); })} label={t('org.addPhoto')} /></div>
        </div>
      </section>
      <h2 className="title3">{t('org.members')} · {c.members}</h2>
      <div className="table-box"><table className="tbl">
        <tbody>{c.members_list.map((m: any) => (
          <tr key={m.id}>
            <td><Link to={`/users/${m.id}`}>{m.name}</Link></td><td><span className="badge">{t(m.role === 'member' ? 'cl.member' : `cl.${m.role}`)}</span></td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {owner && m.role !== 'owner' && (
                <>
                  <button className="btn sm gray" onClick={() => act(async () => { await api.post(`/clubs/${c.id}/members/${m.id}`, { role: m.role === 'co_organizer' ? 'member' : 'co_organizer' }); reload(); })}>{m.role === 'co_organizer' ? t('org.makeMember') : t('org.makeCo')}</button>{' '}
                  <button className="btn sm danger" onClick={() => act(async () => { await api.post(`/clubs/${c.id}/members/${m.id}`, { role: 'remove' }); reload(); })}>{t('org.remove')}</button>
                </>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      <h2 className="title3">{t('cl.upcoming')}</h2>
      <div className="table-box"><table className="tbl"><tbody>{c.runs.map((r: any) => <tr key={r.id}><td><Link to={`/runs/${r.id}`}>{r.title}</Link></td><td>{fmtDateTime(r.start_at, lang)}</td><td>{r.participants_count}</td><td>{r.recurrence_rule ? t('org.series') : ''}</td></tr>)}</tbody></table></div>
    </>
  );
}

function Events() {
  const { t, lang, toast, errorText } = useApp();
  const nav = useNavigate();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/organizer/events'));
  const [f, setF] = useState<any>({ title: '', type: 'race', date: '', time: '08:00', location: '', distances: '5:0:300, 10:0:200', description: '' });
  const [regs, setRegs] = useState<any>(null);
  const create = async () => {
    try {
      const distances = f.distances.split(',').map((s: string) => s.trim()).filter(Boolean).map((s: string) => {
        const [km, price, limit] = s.split(':').map(Number);
        return { km, price: price || 0, limit: limit || null };
      });
      await api.post('/events', { title: f.title, type: f.type, start_at: new Date(`${f.date}T${f.time}:00+05:00`).toISOString(), location: f.location || null, description: f.description || null, distances });
      reload();
      setF({ ...f, title: '' });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  if (loading) return <Loading />;
  if (!rows) return <Empty icon="lock" text={t('err.forbidden')} action={<button className="btn sm" onClick={() => nav('/organizer')}>{t('org.overview')}</button>} />;
  return (
    <>
      <CabHead title={t('org.events')} />
      <div className="table-box"><table className="tbl">
        <thead><tr><th>{t('adm.titleField')}</th><th>{t('rf.date')}</th><th>{t('adm.registered')}</th><th>{t('adm.revenue')}</th><th /></tr></thead>
        <tbody>{rows.map((e) => (
          <tr key={e.id}><td><Link to={`/events/${e.id}`}>{e.title}</Link></td><td>{fmtDateTime(e.start_at, lang)}</td><td>{e.registered}</td><td>{fmtNum(e.revenue, lang)}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              <button className="btn sm gray" onClick={async () => setRegs({ e, rows: await api.get(`/events/${e.id}/registrations`) })}>{t('org.registrations')}</button>{' '}
              <button className="btn sm gray" onClick={() => api.download(`/events/${e.id}/registrations?format=csv`, 'registrations.csv')}>CSV</button>
            </td></tr>
        ))}</tbody>
      </table></div>
      <section className="kpi" style={{ gap: 12 }}>
        <h2 className="title3">{t('org.newEvent')}</h2>
        <div className="form-grid">
          <label>{t('adm.titleField')}<input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label>{t('adm.kind')}<select className="inp" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{['race', 'eco_run', 'virtual'].map((x) => <option key={x} value={x}>{t(`ev.type.${x}`)}</option>)}</select></label>
          <label>{t('rf.date')}<input className="inp" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
          <label>{t('rf.time')}<input className="inp" type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></label>
          <label>{t('rf.address')}<input className="inp" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
          <label>{t('org.distances')}<input className="inp" value={f.distances} onChange={(e) => setF({ ...f, distances: e.target.value })} /><span className="caption">{t('org.distancesHint')}</span></label>
        </div>
        <label className="footnote">{t('pt.description')}<textarea className="inp" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={!f.title || !f.date} onClick={create}>{t('common.create')}</button>
      </section>
      <Sheet open={Boolean(regs)} onClose={() => setRegs(null)} title={regs?.e.title}>
        {regs && <div className="table-box"><table className="tbl"><tbody>{regs.rows.map((r: any, i: number) => <tr key={i}><td>{r.name}</td><td>{r.distance_km} km</td><td>{r.status}</td><td><code>{r.ticket_code}</code></td></tr>)}</tbody></table></div>}
      </Sheet>
    </>
  );
}

export default function OrganizerApp() {
  const { t, me } = useApp();
  const nav = [
    { to: '/organizer', icon: 'chart', label: t('org.overview') },
    { to: '/organizer/runs', icon: 'runner', label: t('org.runs') },
    ...(me?.clubs.filter((c) => c.role !== 'member').map((c) => ({ to: `/organizer/clubs/${c.id}`, icon: 'people', label: c.name })) ?? []),
    ...(['event_organizer', 'admin'].includes(me?.role ?? '') ? [{ to: '/organizer/events', icon: 'ticket', label: t('org.events') }] : []),
  ];
  return (
    <CabinetLayout title={t('org.title')} nav={nav}>
      <Routes>
        <Route index element={<Overview />} />
        <Route path="runs" element={<AllRuns />} />
        <Route path="clubs/:id" element={<ClubManage />} />
        <Route path="events" element={<Events />} />
      </Routes>
    </CabinetLayout>
  );
}
