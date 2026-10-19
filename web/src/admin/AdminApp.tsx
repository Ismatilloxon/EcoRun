import { useEffect, useState } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Empty, ErrorBox, Loading, Sheet } from '../ui/ui.tsx';
import { BarChart, CabHead, CabinetLayout, Kpi, useDebounced } from '../cabinet.tsx';
import { RewardEditor } from '../partner/PartnerApp.tsx';
import { QrCode } from '../components/Qr.tsx';

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

function Dashboard() {
  const { t, lang } = useApp();
  const [d, loading, error, reload] = useLoad<any>(() => api.get('/admin/dashboard'));
  if (loading) return <Loading />;
  if (error) {
    const mfa = (error as any)?.code === 'mfa_required';
    return mfa ? <Empty icon="lock" text={t('adm.mfaNeeded')} /> : <ErrorBox error={error} retry={reload} />;
  }
  const k = d.kpi;
  const n = (v: number) => fmtNum(v, lang);
  const joinRate = k.joins_30d ? Math.round((k.checkins_30d / k.joins_30d) * 100) : 0;
  const s = (key: string) => d.series.map((r: any) => ({ x: r.day, y: Number(r[key]) }));
  return (
    <>
      <CabHead title={t('adm.dashboard')}><button className="btn sm gray" onClick={reload}><Icon name="refresh" size={16} /></button></CabHead>
      <div className="kpis">
        <Kpi label={t('adm.dau')} value={n(k.dau)} />
        <Kpi label={t('adm.wau')} value={n(k.wau)} />
        <Kpi label={t('adm.mau')} value={n(k.mau)} />
        <Kpi label={t('adm.online')} value={n(k.online)} />
        <Kpi label={t('adm.usersTotal')} value={n(k.users_total)} hint={`${t('adm.onboarded')}: ${n(k.onboarded)}`} />
        <Kpi label={t('adm.signups7')} value={n(k.signups_7d)} />
        <Kpi label={t('adm.runs7')} value={n(k.runs_7d)} />
        <Kpi label={t('adm.checkins7')} value={n(k.checkins_7d)} />
        <Kpi label={t('adm.joinRate')} value={`${joinRate}%`} hint={`${k.checkins_30d}/${k.joins_30d}`} />
        <Kpi label={t('adm.eco7')} value={n(k.eco_7d)} />
        <Kpi label={t('adm.pointsIssued')} value={n(k.points_issued_30d)} />
        <Kpi label={t('adm.pointsSpent')} value={n(k.points_spent_30d)} />
        <Kpi label={t('adm.redeemed')} value={n(k.redeemed_30d)} />
      </div>
      <h2 className="title3">{t('adm.queue')}</h2>
      <div className="kpis">
        {[['adm.reports', k.open_reports], ['adm.ecoPhotos', k.pending_eco], ['adm.spots', k.pending_spots], ['adm.clubVerify', k.pending_clubs]].map(([l, v]) => (
          <Link key={l} to="/admin/moderation" className="kpi" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="l">{t(l)}</span><span className="v" style={{ color: v ? 'var(--orange)' : undefined }}>{v}</span>
          </Link>
        ))}
      </div>
      <h2 className="title3">{t('adm.activity30')}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {[['active', 'adm.active'], ['signups', 'adm.signups'], ['checkins', 'adm.checkins'], ['eco', 'adm.ecoActions']].map(([key, l]) => (
          <div key={key} className="kpi"><BarChart data={s(key)} label={t(l)} valueLabel={t(l)} /></div>
        ))}
      </div>
    </>
  );
}

const ROLES = ['runner', 'club_organizer', 'partner', 'event_organizer', 'moderator', 'admin'];

function Users() {
  const { t, lang, me } = useApp();
  const act = useAct();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const dq = useDebounced(q);
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get(`/admin/users?${new URLSearchParams({ ...(dq ? { q: dq } : {}), ...(role ? { role } : {}) })}`), [dq, role]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, , , reloadDetail] = useLoad<any>(() => (sel ? api.get(`/admin/users/${sel}`) : Promise.resolve(null)), [sel]);
  const [partners] = useLoad<any[]>(() => (me?.role === 'admin' ? api.get('/admin/partners') : Promise.resolve([])));
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const refresh = () => (reload(), reloadDetail());
  return (
    <>
      <CabHead title={t('adm.users')}>
        <input aria-label={t('common.search')} placeholder={t('adm.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('adm.role')} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">{t('adm.allRoles')}</option>
          {ROLES.map((r) => <option key={r}>{r}</option>)}
        </select>
      </CabHead>
      {loading ? <Loading /> : (
        <div className="table-box">
          <table className="tbl">
            <thead><tr><th>{t('adm.name')}</th><th>{t('adm.phone')}</th><th>{t('adm.role')}</th><th>{t('ob.district')}</th><th>{t('pr.points')}</th><th>{t('adm.lastSeen')}</th><th>{t('adm.joined')}</th><th>{t('adm.status')}</th></tr></thead>
            <tbody>
              {rows?.map((u) => (
                <tr key={u.id} className="click" onClick={() => setSel(u.id)}>
                  <td>{u.name ?? '—'}{u.telegram_username && <span className="caption"> @{u.telegram_username}</span>}</td>
                  <td>{u.phone ?? '—'}</td><td><span className="badge">{u.role}</span></td><td>{u.district ?? '—'}</td>
                  <td>{u.points}</td><td>{u.last_seen ? fmtDate(u.last_seen, lang) : '—'}</td><td>{fmtDate(u.created_at, lang)}</td>
                  <td>{u.deleted ? <span className="badge">deleted</span> : u.blocked ? <span className="badge red">{t('adm.blocked')}</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Sheet open={Boolean(sel)} onClose={() => setSel(null)} title={detail?.user?.name ?? ''}>
        {!detail ? <Loading /> : (
          <div className="col cab" style={{ display: 'flex', gap: 14, minHeight: 0, background: 'none' }}>
            <div className="kpis">
              <Kpi label={t('pr.points')} value={detail.points.balance} hint={`${t('pstatus.pending')}: ${detail.points.pending}`} />
              <Kpi label={t('adm.role')} value={<span style={{ fontSize: 17 }}>{detail.user.role}</span>} />
              <Kpi label={t('adm.phone')} value={<span style={{ fontSize: 15 }}>{detail.user.phone ?? '—'}</span>} />
            </div>
            <div className="toolbar">
              <button className={`btn sm ${detail.user.blocked ? '' : 'danger'}`} onClick={() => act(async () => { await api.post(`/admin/users/${sel}/block`, { blocked: !detail.user.blocked, reason: note || null }); refresh(); }, true)}>
                {detail.user.blocked ? t('adm.unblock') : t('adm.block')}
              </button>
              {me?.role === 'admin' && (
                <select aria-label={t('adm.changeRole')} value={detail.user.role} onChange={(e) => act(async () => { await api.post(`/admin/users/${sel}/role`, { role: e.target.value }); refresh(); }, true)}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
              )}
            </div>
            {me?.role === 'admin' && (
              <>
                <h3 className="headline">{t('adm.adjustPoints')}</h3>
                <div className="toolbar">
                  <input type="number" aria-label={t('adm.amount')} placeholder={t('adm.amount')} value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} />
                  <input aria-label={t('adm.note')} placeholder={t('adm.note')} value={note} onChange={(e) => setNote(e.target.value)} />
                  <button className="btn sm" disabled={!amount || note.length < 3} onClick={() => act(async () => { await api.post(`/admin/users/${sel}/points`, { amount: Number(amount), note }); setAmount(''); refresh(); }, true)}>{t('common.apply')}</button>
                  <button className="btn sm danger" disabled={note.length < 3} onClick={() => act(async () => { await api.post(`/admin/users/${sel}/points`, { reset: true, note }); refresh(); }, true)}>{t('adm.resetPoints')}</button>
                </div>
                <h3 className="headline">{t('adm.linkPartner')}</h3>
                <div className="toolbar">
                  {detail.partners.map((p: any) => (
                    <button key={p.id} className="btn sm gray" onClick={() => act(async () => { await api.post(`/admin/users/${sel}/partner`, { partner_id: p.id, remove: true }); refresh(); })}>{p.name} ✕</button>
                  ))}
                  <select aria-label={t('adm.linkPartner')} value="" onChange={(e) => e.target.value && act(async () => { await api.post(`/admin/users/${sel}/partner`, { partner_id: e.target.value }); refresh(); }, true)}>
                    <option value="">+ {t('adm.partners')}</option>
                    {partners?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </>
            )}
            <h3 className="headline">{t('adm.transactions')}</h3>
            <div className="table-box"><table className="tbl"><tbody>
              {detail.transactions.map((x: any) => <tr key={x.id}><td>{fmtDateTime(x.created_at, lang)}</td><td>{t(`reason.${x.reason}`)}</td><td>{x.amount}</td><td>{t(`pstatus.${x.status}`)}</td><td className="caption">{x.note}</td></tr>)}
            </tbody></table></div>
            <h3 className="headline">{t('adm.activities')}</h3>
            <div className="table-box"><table className="tbl"><tbody>
              {detail.activities.map((a: any) => <tr key={a.id}><td>{fmtDateTime(a.started_at, lang)}</td><td>{(a.distance_m / 1000).toFixed(2)} km</td><td>{a.source}</td><td>{a.flagged && <span className="badge red">{a.flag_reason}</span>}</td></tr>)}
            </tbody></table></div>
          </div>
        )}
      </Sheet>
    </>
  );
}

function Moderation() {
  const { t, lang } = useApp();
  const act = useAct();
  const [d, loading, , reload] = useLoad<any>(() => api.get('/admin/moderation'));
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const R = (id: string) => reasons[id] ?? '';
  const reasonInput = (id: string) => <input className="inp" aria-label={t('adm.reason')} placeholder={t('adm.reason')} value={R(id)} onChange={(e) => setReasons((x) => ({ ...x, [id]: e.target.value }))} />;
  if (loading || !d) return <Loading />;
  const verif = (v: any) => [
    v?.device_distance_m != null && t('adm.deviceDistance', { m: v.device_distance_m }),
    v?.exif?.lat != null ? (v.exif_geo_ok !== false && v.exif_time_ok !== false ? t('adm.exifOk') : '✕ EXIF') : t('adm.exifMissing'),
  ].filter(Boolean).join(' · ');
  return (
    <>
      <CabHead title={t('adm.moderation')}><button className="btn sm gray" onClick={reload}><Icon name="refresh" size={16} /></button></CabHead>
      <h2 className="title3">{t('adm.ecoPhotos')} · {d.eco.length}</h2>
      {!d.eco.length ? <p className="muted">{t('adm.empty')}</p> : d.eco.map((e: any) => (
        <div key={e.id} className="mod-card">
          {e.photo_after_url ? <a href={assetUrl(e.photo_after_url)} target="_blank" rel="noreferrer"><img src={assetUrl(e.photo_after_url)} alt="" /></a> : <div className="photo-input" style={{ width: 120, height: 90 }}><Icon name="image" /></div>}
          <div className="col" style={{ gap: 4 }}>
            <b>{e.user.name}</b>
            <span className="sub">{e.run_title ?? t('adm.solo')} · {e.bags_small} S + {e.bags_large} L · {e.waste_types.join(', ')}</span>
            <span className="caption">{fmtDateTime(e.created_at, lang)} · {verif(e.verification)}</span>
            {e.photo_before_url && <a className="caption" href={assetUrl(e.photo_before_url)} target="_blank" rel="noreferrer">{t('eco.before')}</a>}
            {reasonInput(e.id)}
          </div>
          <div className="mod-actions">
            <button className="btn sm" onClick={() => act(async () => { await api.post(`/admin/eco/${e.id}/review`, { approve: true }); reload(); })}>{t('adm.approve')}</button>
            <button className="btn sm danger" disabled={!R(e.id)} onClick={() => act(async () => { await api.post(`/admin/eco/${e.id}/review`, { approve: false, reason: R(e.id) }); reload(); })}>{t('adm.reject')}</button>
          </div>
        </div>
      ))}
      <h2 className="title3">{t('adm.reports')} · {d.reports.length}</h2>
      {!d.reports.length ? <p className="muted">{t('adm.empty')}</p> : d.reports.map((r: any) => (
        <div key={r.id} className="mod-card" style={{ gridTemplateColumns: '1fr auto' }}>
          <div className="col" style={{ gap: 4 }}>
            <b>{t(`adm.target_${r.target_type}`)}: {r.target_label ?? r.target_id}</b>
            <span className="sub">{t(`rp.r.${r.reason}`)} · {t('adm.reporter')}: {r.reporter_name} · {fmtDateTime(r.created_at, lang)}</span>
            {r.details && <span>{r.details}</span>}
            {reasonInput(r.id)}
          </div>
          <div className="mod-actions">
            <button className="btn sm gray" onClick={() => act(async () => { await api.post(`/admin/reports/${r.id}/resolve`, { status: 'dismissed', note: R(r.id) || null }); reload(); })}>{t('adm.dismiss')}</button>
            {r.target_type !== 'user' && <button className="btn sm tinted" onClick={() => act(async () => { await api.post(`/admin/reports/${r.id}/resolve`, { status: 'resolved', action: 'hide_target', note: R(r.id) || null }); reload(); })}>{t('adm.hideTarget')}</button>}
            <button className="btn sm danger" onClick={() => act(async () => { await api.post(`/admin/reports/${r.id}/resolve`, { status: 'resolved', action: 'block_user', note: R(r.id) || null }); reload(); })}>{t('adm.blockUser')}</button>
          </div>
        </div>
      ))}
      <h2 className="title3">{t('adm.spots')} · {d.spots.length}</h2>
      {!d.spots.length ? <p className="muted">{t('adm.empty')}</p> : d.spots.map((s: any) => (
        <div key={s.id} className="mod-card">
          {s.photo_url ? <img src={assetUrl(s.photo_url)} alt="" /> : <div className="photo-input" style={{ width: 120, height: 90 }}><Icon name="pin" /></div>}
          <div className="col" style={{ gap: 4 }}>
            <b>{s.description ?? '—'}</b>
            <span className="sub">{s.reporter_name} · {fmtDateTime(s.created_at, lang)} · <a href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=17/${s.lat}/${s.lng}`} target="_blank" rel="noreferrer">{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</a></span>
            {reasonInput(s.id)}
          </div>
          <div className="mod-actions">
            <button className="btn sm" onClick={() => act(async () => { await api.post(`/admin/spots/${s.id}/review`, { approve: true }); reload(); })}>{t('adm.approve')}</button>
            <button className="btn sm danger" onClick={() => act(async () => { await api.post(`/admin/spots/${s.id}/review`, { approve: false, reason: R(s.id) || null }); reload(); })}>{t('adm.reject')}</button>
          </div>
        </div>
      ))}
      <h2 className="title3">{t('adm.clubVerify')} · {d.clubs.length}</h2>
      {!d.clubs.length ? <p className="muted">{t('adm.empty')}</p> : d.clubs.map((c: any) => (
        <div key={c.id} className="mod-card" style={{ gridTemplateColumns: '1fr auto' }}>
          <div className="col" style={{ gap: 4 }}>
            <Link to={`/clubs/${c.id}`}><b>{c.name}</b></Link>
            <span className="sub">{c.district} · {t('cl.members', { n: c.members })} · {fmtDateTime(c.verification_requested_at, lang)}</span>
            <span className="caption">{c.description}</span>
          </div>
          <div className="mod-actions">
            <button className="btn sm" onClick={() => act(async () => { await api.post(`/admin/clubs/${c.id}/verify`, { approve: true }); reload(); })}>{t('adm.verify')}</button>
            <button className="btn sm danger" onClick={() => act(async () => { await api.post(`/admin/clubs/${c.id}/verify`, { approve: false }); reload(); })}>{t('adm.reject')}</button>
          </div>
        </div>
      ))}
      <h2 className="title3">{t('adm.sponsored')} · {d.challenges.length}</h2>
      {!d.challenges.length ? <p className="muted">{t('adm.empty')}</p> : d.challenges.map((c: any) => (
        <div key={c.id} className="mod-card" style={{ gridTemplateColumns: '1fr auto' }}>
          <div className="col"><b>{c.title?.[lang] ?? c.title?.en}</b><span className="sub">{c.sponsor_name} · {c.metric} ≥ {c.target} · +{c.reward_points}</span></div>
          <div className="mod-actions"><button className="btn sm" onClick={() => act(async () => { await api.patch(`/admin/challenges/${c.id}`, { active: true }); reload(); })}>{t('adm.approve')}</button></div>
        </div>
      ))}
    </>
  );
}

function Runs() {
  const { t, lang } = useApp();
  const act = useAct();
  const [scope, setScope] = useState('upcoming');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get(`/admin/runs?scope=${scope}${dq ? `&q=${encodeURIComponent(dq)}` : ''}`), [scope, dq]);
  const patch = (id: string, body: any) => act(async () => { await api.patch(`/admin/runs/${id}`, body); reload(); });
  return (
    <>
      <CabHead title={t('adm.runs')}>
        <input aria-label={t('common.search')} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('adm.status')} value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="upcoming">{t('adm.upcoming')}</option><option value="past">{t('adm.past')}</option><option value="all">{t('common.all')}</option>
        </select>
      </CabHead>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('rf.name')}</th><th>{t('rf.date')}</th><th>{t('adm.organizer')}</th><th>{t('adm.participants')}</th><th>{t('adm.status')}</th><th /></tr></thead>
          <tbody>{rows?.map((r) => (
            <tr key={r.id}>
              <td><Link to={`/runs/${r.id}`}>{r.title}</Link><div className="caption">{t(`type.${r.type}`)}{r.club ? ` · ${r.club}` : ''}{r.women_only ? ` · ${t('runs.womenOnly')}` : ''}</div></td>
              <td>{fmtDateTime(r.start_at, lang)}</td><td>{r.organizer}</td><td>{r.checked_in}/{r.joined}</td>
              <td>{r.status !== 'scheduled' && <span className="badge">{r.status}</span>} {r.hidden && <span className="badge red">{t('adm.hidden')}</span>} {r.featured && <span className="badge green">{t('adm.featured')}</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm gray" onClick={() => patch(r.id, { featured: !r.featured })}>{r.featured ? t('adm.unfeature') : t('adm.feature')}</button>{' '}
                <button className="btn sm danger" onClick={() => patch(r.id, { hidden: !r.hidden })}>{r.hidden ? t('adm.show') : t('adm.hide')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function Clubs() {
  const { t, lang } = useApp();
  const act = useAct();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/admin/clubs'));
  const patch = (id: string, body: any) => act(async () => { await api.patch(`/admin/clubs/${id}`, body); reload(); });
  return (
    <>
      <CabHead title={t('adm.clubs')} />
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.name')}</th><th>{t('adm.owner')}</th><th>{t('adm.members')}</th><th>{t('adm.joined')}</th><th /></tr></thead>
          <tbody>{rows?.map((c) => (
            <tr key={c.id}>
              <td><Link to={`/clubs/${c.id}`}>{c.name}</Link> {c.verified && <Icon name="checkCircle" size={14} className="accent" />} {c.hidden && <span className="badge red">{t('adm.hidden')}</span>}</td>
              <td>{c.owner}</td><td>{c.members}</td><td>{fmtDate(c.created_at, lang)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm gray" onClick={() => patch(c.id, { verified: !c.verified })}>{c.verified ? t('adm.unverify') : t('adm.verify')}</button>{' '}
                <button className="btn sm gray" onClick={() => patch(c.id, { featured: !c.featured })}>{c.featured ? t('adm.unfeature') : t('adm.feature')}</button>{' '}
                <button className="btn sm danger" onClick={() => patch(c.id, { hidden: !c.hidden })}>{c.hidden ? t('adm.show') : t('adm.hide')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function PointsSettings() {
  const { t } = useApp();
  const act = useAct();
  const [d, loading] = useLoad<any>(() => api.get('/admin/settings'));
  const [s, setS] = useState<any>(null);
  useEffect(() => {
    d && setS(structuredClone(d.settings));
  }, [d]);
  if (loading || !s) return <Loading />;
  return (
    <>
      <CabHead title={t('adm.points')}><button className="btn sm" onClick={() => act(async () => setS(await api.put('/admin/settings', s)), true)}>{t('adm.saveSettings')}</button></CabHead>
      <p className="footnote">{t('adm.coefSource')}</p>
      {Object.keys(s).filter((k) => k !== 'levels').map((sec) => (
        <section key={sec} className="kpi" style={{ gap: 10 }}>
          <h2 className="title3">{t(`set.${sec}`)}</h2>
          <div className="form-grid">
            {Object.keys(s[sec]).map((k) => (
              <label key={k}>
                {t(`set.${sec}.${k}`)}
                <input className="inp" type="number" min={0} step="any" value={s[sec][k]} onChange={(e) => setS({ ...s, [sec]: { ...s[sec], [k]: Number(e.target.value) } })} />
                <span className="caption">default {d.defaults[sec][k]}</span>
              </label>
            ))}
          </div>
        </section>
      ))}
      <section className="kpi" style={{ gap: 10 }}>
        <h2 className="title3">{t('adm.levels')}</h2>
        <input className="inp" value={s.levels.join(', ')} onChange={(e) => setS({ ...s, levels: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)) })} />
      </section>
    </>
  );
}

function Partners() {
  const { t } = useApp();
  const act = useAct();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/admin/partners'));
  const [edit, setEdit] = useState<any>(null);
  const save = () =>
    act(async () => {
      const body = {
        name: edit.name, description: edit.description || null, contract_status: edit.contract_status,
        contacts: { phone: edit.phone ?? '', person: edit.person ?? '', email: edit.email ?? '', telegram: edit.telegram ?? '' },
        branches: String(edit.branchesText ?? '').split('\n').map((l: string) => l.trim()).filter(Boolean).map((l: string) => { const [name, address] = l.split('—').map((x) => x.trim()); return { name, address: address ?? '' }; }),
      };
      if (edit.id) await api.patch(`/admin/partners/${edit.id}`, body);
      else await api.post('/admin/partners', body);
      setEdit(null);
      reload();
    }, true);
  return (
    <>
      <CabHead title={t('adm.partners')}><button className="btn sm" onClick={() => setEdit({ contract_status: 'active' })}><Icon name="plus" size={16} /> {t('adm.newPartner')}</button></CabHead>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.name')}</th><th>{t('adm.contract')}</th><th>{t('adm.rewards')}</th><th>{t('adm.redemptions')}</th><th>{t('adm.users_')}</th><th /></tr></thead>
          <tbody>{rows?.map((p) => (
            <tr key={p.id}>
              <td>{p.name}<div className="caption">{p.branches?.map((b: any) => b.name).join(', ')}</div></td>
              <td><span className={`badge ${p.contract_status === 'active' ? 'green' : ''}`}>{p.contract_status}</span></td>
              <td>{p.rewards}</td><td>{p.redeemed}</td><td className="caption">{p.users?.map((u: any) => u.name).join(', ') ?? '—'}</td>
              <td><button className="btn sm gray" onClick={() => setEdit({ ...p, ...p.contacts, branchesText: (p.branches ?? []).map((b: any) => `${b.name} — ${b.address ?? ''}`).join('\n') })}>{t('common.edit')}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? edit.name : t('adm.newPartner')} right={<button className="btn plain" onClick={save} disabled={!edit?.name}>{t('common.save')}</button>}>
        {edit && (
          <div className="cab" style={{ display: 'block', minHeight: 0, background: 'none' }}>
            <div className="form-grid">
              <label>{t('adm.name')}<input className="inp" value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
              <label>{t('adm.contract')}<select className="inp" value={edit.contract_status} onChange={(e) => setEdit({ ...edit, contract_status: e.target.value })}>{['lead', 'active', 'paused', 'ended'].map((s) => <option key={s}>{s}</option>)}</select></label>
              <label>{t('adm.phone')}<input className="inp" value={edit.phone ?? ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
              <label>{t('adm.contacts')}<input className="inp" value={edit.person ?? ''} onChange={(e) => setEdit({ ...edit, person: e.target.value })} /></label>
            </div>
            <label className="footnote" style={{ display: 'block', marginTop: 12 }}>{t('pt.description')}<textarea className="inp" value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></label>
            <label className="footnote" style={{ display: 'block', marginTop: 12 }}>{t('adm.branches')}<textarea className="inp" value={edit.branchesText ?? ''} onChange={(e) => setEdit({ ...edit, branchesText: e.target.value })} /></label>
          </div>
        )}
      </Sheet>
    </>
  );
}

function Rewards() {
  const { t, lang } = useApp();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/admin/rewards'));
  const [partners] = useLoad<any[]>(() => api.get('/admin/partners'));
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <CabHead title={t('adm.rewards')}><button className="btn sm" onClick={() => setEdit({ partner_id: partners?.[0]?.id })}><Icon name="plus" size={16} /> {t('adm.newReward')}</button></CabHead>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.titleField')}</th><th>{t('adm.partners')}</th><th>{t('pt.price')}</th><th>{t('pt.stock')}</th><th>{t('pt.redeemed')}</th><th>{t('pt.validUntil')}</th><th /></tr></thead>
          <tbody>{rows?.map((r) => (
            <tr key={r.id}>
              <td>{r.title} {!r.active && <span className="badge">{t('pt.inactive')}</span>}</td><td>{r.partner_name}</td><td>{r.points_price}</td><td>{r.stock}</td><td>{r.redeemed}</td>
              <td>{r.valid_until ? fmtDate(r.valid_until, lang) : '—'}</td><td><button className="btn sm gray" onClick={() => setEdit(r)}>{t('common.edit')}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <RewardEditor value={edit} partners={partners ?? []} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

const emptyI18n = { uz: '', ru: '', en: '' };
function I18nInput({ label, value, onChange }: { label: string; value: any; onChange: (v: any) => void }) {
  return (
    <div className="form-grid">
      {(['uz', 'ru', 'en'] as const).map((l) => (
        <label key={l}>{label} ({l.toUpperCase()})<input className="inp" value={value?.[l] ?? ''} onChange={(e) => onChange({ ...emptyI18n, ...value, [l]: e.target.value })} /></label>
      ))}
    </div>
  );
}

function Challenges() {
  const { t, lang, me } = useApp();
  const act = useAct();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/admin/challenges'));
  const [partners] = useLoad<any[]>(() => (me?.role === 'admin' ? api.get('/admin/partners') : Promise.resolve([])));
  const [edit, setEdit] = useState<any>(null);
  const toIso = (d: string) => new Date(`${d}T00:00:00+05:00`).toISOString();
  const save = () =>
    act(async () => {
      const body: any = {
        title: edit.title, description: edit.description ?? emptyI18n, reward_text: edit.reward_text ?? emptyI18n, metric: edit.metric, target: Number(edit.target),
        starts_at: toIso(edit.starts), ends_at: toIso(edit.ends), reward_points: Number(edit.reward_points ?? 0), badge_code: edit.badge_code || null,
        sponsor_partner_id: edit.sponsor_partner_id || null, active: edit.active ?? true,
      };
      if (edit.id) await api.patch(`/admin/challenges/${edit.id}`, body);
      else await api.post('/admin/challenges', body);
      setEdit(null);
      reload();
    }, true);
  return (
    <>
      <CabHead title={t('adm.challenges')}>{me?.role === 'admin' && <button className="btn sm" onClick={() => setEdit({ title: emptyI18n, metric: 'km', target: 50, reward_points: 50, starts: new Date().toISOString().slice(0, 10), ends: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) })}><Icon name="plus" size={16} /> {t('adm.newChallenge')}</button>}</CabHead>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.titleField')}</th><th>{t('adm.metric')}</th><th>{t('adm.starts')}</th><th>{t('adm.ends')}</th><th>{t('adm.participants')}</th><th>{t('adm.sponsor')}</th><th /></tr></thead>
          <tbody>{rows?.map((c) => (
            <tr key={c.id}>
              <td>{c.title?.[lang] ?? c.title?.en} {!c.active && <span className="badge orange">{t('pt.waiting')}</span>}</td>
              <td>{c.metric} ≥ {c.target} · +{c.reward_points}</td><td>{fmtDate(c.starts_at, lang)}</td><td>{fmtDate(c.ends_at, lang)}</td>
              <td>{c.completed}/{c.participants}</td><td>{c.sponsor_name ?? '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm gray" onClick={() => act(async () => { await api.patch(`/admin/challenges/${c.id}`, { active: !c.active }); reload(); })}>{c.active ? t('adm.hide') : t('adm.approve')}</button>{' '}
                {me?.role === 'admin' && <button className="btn sm gray" onClick={() => setEdit({ ...c, starts: c.starts_at.slice(0, 10), ends: c.ends_at.slice(0, 10) })}>{t('common.edit')}</button>}
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={t('adm.newChallenge')} right={<button className="btn plain" onClick={save}>{t('common.save')}</button>}>
        {edit && (
          <div className="cab col" style={{ display: 'flex', minHeight: 0, background: 'none', gap: 12 }}>
            <I18nInput label={t('adm.titleField')} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            <I18nInput label={t('pt.description')} value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
            <div className="form-grid">
              <label>{t('adm.metric')}<select className="inp" value={edit.metric} onChange={(e) => setEdit({ ...edit, metric: e.target.value })}>{['km', 'runs', 'group_runs', 'plogging_runs', 'eco_points'].map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>{t('adm.targetValue')}<input className="inp" type="number" value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} /></label>
              <label>{t('adm.rewardPoints')}<input className="inp" type="number" value={edit.reward_points} onChange={(e) => setEdit({ ...edit, reward_points: e.target.value })} /></label>
              <label>{t('adm.starts')}<input className="inp" type="date" value={edit.starts} onChange={(e) => setEdit({ ...edit, starts: e.target.value })} /></label>
              <label>{t('adm.ends')}<input className="inp" type="date" value={edit.ends} onChange={(e) => setEdit({ ...edit, ends: e.target.value })} /></label>
              <label>{t('adm.badge')}<input className="inp" value={edit.badge_code ?? ''} onChange={(e) => setEdit({ ...edit, badge_code: e.target.value })} /></label>
              <label>{t('adm.sponsor')}<select className="inp" value={edit.sponsor_partner_id ?? ''} onChange={(e) => setEdit({ ...edit, sponsor_partner_id: e.target.value })}><option value="">—</option>{partners?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

function Campaigns() {
  const { t, lang } = useApp();
  const act = useAct();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/admin/campaigns'));
  const [meta] = useLoad<any>(() => api.get('/meta'));
  const [f, setF] = useState<any>({ title: '', body: '', segment: {}, scheduled_at: '' });
  const [aud, setAud] = useState<number | null>(null);
  const seg = f.segment;
  const segClean = { district: seg.district || null, level: seg.level || null, language: seg.language || null, active_days: seg.active_days ? Number(seg.active_days) : null, inactive_days: seg.inactive_days ? Number(seg.inactive_days) : null };
  useEffect(() => {
    api.post('/admin/campaigns/preview', { segment: segClean }).then((r) => setAud(r.audience)).catch(() => setAud(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(seg)]);
  const send = (now: boolean) =>
    act(async () => {
      await api.post('/admin/campaigns', { title: f.title, body: f.body, segment: segClean, send_now: now, scheduled_at: now ? null : new Date(f.scheduled_at).toISOString() });
      setF({ title: '', body: '', segment: {}, scheduled_at: '' });
      reload();
    }, true);
  const setSeg = (k: string, v: any) => setF({ ...f, segment: { ...seg, [k]: v } });
  return (
    <>
      <CabHead title={t('adm.campaigns')} />
      <section className="kpi" style={{ gap: 12 }}>
        <h2 className="title3">{t('adm.newCampaign')}</h2>
        <div className="form-grid">
          <label>{t('adm.titleField')}<input className="inp" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label>{t('ob.district')}<select className="inp" value={seg.district ?? ''} onChange={(e) => setSeg('district', e.target.value)}><option value="">{t('adm.any')}</option>{meta?.districts.map((d: string) => <option key={d}>{d}</option>)}</select></label>
          <label>{t('ob.level')}<select className="inp" value={seg.level ?? ''} onChange={(e) => setSeg('level', e.target.value)}><option value="">{t('adm.any')}</option>{['beginner', 'intermediate', 'advanced'].map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}</select></label>
          <label>{t('adm.language')}<select className="inp" value={seg.language ?? ''} onChange={(e) => setSeg('language', e.target.value)}><option value="">{t('adm.any')}</option>{['uz', 'ru', 'en'].map((l) => <option key={l}>{l}</option>)}</select></label>
          <label>{t('adm.activeDays')}<input className="inp" type="number" min={1} value={seg.active_days ?? ''} onChange={(e) => setSeg('active_days', e.target.value)} /></label>
          <label>{t('adm.inactiveDays')}<input className="inp" type="number" min={1} value={seg.inactive_days ?? ''} onChange={(e) => setSeg('inactive_days', e.target.value)} /></label>
        </div>
        <label className="footnote">{t('adm.body')}<textarea className="inp" maxLength={1000} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
        <div className="toolbar">
          <span className="badge blue">{t('adm.audience', { n: aud ?? '…' })}</span>
          <button className="btn sm" disabled={!f.title || !f.body} onClick={() => send(true)}><Icon name="send" size={16} /> {t('adm.sendNow')}</button>
          <input type="datetime-local" aria-label={t('adm.schedule')} value={f.scheduled_at} onChange={(e) => setF({ ...f, scheduled_at: e.target.value })} />
          <button className="btn sm gray" disabled={!f.title || !f.body || !f.scheduled_at} onClick={() => send(false)}>{t('adm.schedule')}</button>
        </div>
      </section>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.titleField')}</th><th>{t('adm.segment')}</th><th>{t('adm.status')}</th></tr></thead>
          <tbody>{rows?.map((c) => (
            <tr key={c.id}>
              <td>{c.title}<div className="caption">{c.body}</div></td>
              <td className="caption">{Object.entries(c.segment).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ') || t('common.all')}</td>
              <td>{c.sent_at ? <span className="badge green">{t('adm.sent', { n: c.sent_count })} · {fmtDateTime(c.sent_at, lang)}</span> : c.scheduled_at ? <span className="badge orange">{t('adm.scheduled')} · {fmtDateTime(c.scheduled_at, lang)}</span> : t('adm.draft')}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function Content() {
  const { t, lang } = useApp();
  const act = useAct();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get('/admin/content'));
  const [edit, setEdit] = useState<any>(null);
  const save = () =>
    act(async () => {
      const body = { kind: edit.kind, title: { ...emptyI18n, ...edit.title }, body: { ...emptyI18n, ...edit.body }, link: edit.link || null, sort: Number(edit.sort ?? 0), active: edit.active ?? true };
      if (edit.id) await api.patch(`/admin/content/${edit.id}`, body);
      else await api.post('/admin/content', body);
      setEdit(null);
      reload();
    }, true);
  return (
    <>
      <CabHead title={t('adm.content')}><button className="btn sm" onClick={() => setEdit({ kind: 'faq', title: emptyI18n, body: emptyI18n })}><Icon name="plus" size={16} /> {t('adm.newContent')}</button></CabHead>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.kind')}</th><th>{t('adm.titleField')}</th><th>{t('adm.sort')}</th><th>{t('adm.activeField')}</th><th /></tr></thead>
          <tbody>{rows?.map((c) => (
            <tr key={c.id}>
              <td><span className="badge">{c.kind}</span></td><td>{c.title?.[lang]}</td><td>{c.sort}</td><td>{c.active ? '✓' : '—'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn sm gray" onClick={() => setEdit(c)}>{t('common.edit')}</button>{' '}
                <button className="btn sm danger" onClick={() => act(async () => { await api.del(`/admin/content/${c.id}`); reload(); })}>{t('common.delete')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <Sheet open={Boolean(edit)} onClose={() => setEdit(null)} title={t('adm.content')} right={<button className="btn plain" onClick={save}>{t('common.save')}</button>}>
        {edit && (
          <div className="cab col" style={{ display: 'flex', minHeight: 0, background: 'none', gap: 12 }}>
            <div className="form-grid">
              <label>{t('adm.kind')}<select className="inp" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}>{['banner', 'faq', 'terms', 'privacy'].map((k) => <option key={k}>{k}</option>)}</select></label>
              <label>{t('adm.sort')}<input className="inp" type="number" value={edit.sort ?? 0} onChange={(e) => setEdit({ ...edit, sort: e.target.value })} /></label>
              <label>{t('adm.link')}<input className="inp" value={edit.link ?? ''} onChange={(e) => setEdit({ ...edit, link: e.target.value })} /></label>
              <label>{t('adm.activeField')}<select className="inp" value={String(edit.active ?? true)} onChange={(e) => setEdit({ ...edit, active: e.target.value === 'true' })}><option value="true">✓</option><option value="false">—</option></select></label>
            </div>
            <I18nInput label={t('adm.titleField')} value={edit.title} onChange={(v) => setEdit({ ...edit, title: v })} />
            {(['uz', 'ru', 'en'] as const).map((l) => (
              <label key={l} className="footnote">{t('adm.body')} ({l.toUpperCase()})<textarea className="inp" value={edit.body?.[l] ?? ''} onChange={(e) => setEdit({ ...edit, body: { ...emptyI18n, ...edit.body, [l]: e.target.value } })} /></label>
            ))}
          </div>
        )}
      </Sheet>
    </>
  );
}

function Events() {
  const { t, lang } = useApp();
  const [rows, loading] = useLoad<any[]>(() => api.get('/admin/events'));
  return (
    <>
      <CabHead title={t('adm.events')} />
      <p className="footnote">{t('ev.paymentsSoon')}</p>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.titleField')}</th><th>{t('rf.date')}</th><th>{t('adm.organizer')}</th><th>{t('adm.registered')}</th><th>{t('adm.revenue')}</th><th>{t('adm.refunds')}</th></tr></thead>
          <tbody>{rows?.map((e) => <tr key={e.id}><td><Link to={`/events/${e.id}`}>{e.title}</Link></td><td>{fmtDate(e.start_at, lang)}</td><td>{e.organizer}</td><td>{e.registered}</td><td>{fmtNum(e.revenue, lang)} {t('common.sum')}</td><td>{e.refunds}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

function Audit() {
  const { t, lang } = useApp();
  const [rows, loading] = useLoad<any[]>(() => api.get('/admin/audit'));
  return (
    <>
      <CabHead title={t('adm.audit')} />
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.when')}</th><th>{t('adm.actor')}</th><th>{t('adm.action')}</th><th>{t('adm.target')}</th><th>IP</th></tr></thead>
          <tbody>{rows?.map((a) => <tr key={a.id}><td>{fmtDateTime(a.created_at, lang)}</td><td>{a.actor_name}</td><td><code>{a.action}</code></td><td className="caption">{a.target_type} {a.target_id?.slice(0, 8)}</td><td className="caption">{a.ip}</td></tr>)}</tbody>
        </table></div>
      )}
    </>
  );
}

function Security() {
  const { t, me, refreshMe } = useApp();
  const act = useAct();
  const [setup, setSetup] = useState<any>(null);
  const [code, setCode] = useState('');
  return (
    <>
      <CabHead title={t('adm.security')} />
      <section className="kpi" style={{ gap: 12, maxWidth: 520 }}>
        <h2 className="title3">{t('adm.mfaTitle')}</h2>
        <p className="muted">{t('adm.mfaBody')}</p>
        {me?.totp_enabled ? <span className="badge green">{t('st.totpOn')}</span> : !setup ? (
          <button className="btn sm" onClick={() => act(async () => setSetup(await api.post('/me/totp/setup')))}>{t('st.totpSetup')}</button>
        ) : (
          <>
            <p className="footnote">{t('st.totpScan')}</p>
            <div style={{ maxWidth: 260 }}><QrCode value={setup.otpauth} label={t('st.totp')} /></div>
            <code style={{ wordBreak: 'break-all' }}>{setup.secret}</code>
            <div className="toolbar">
              <input aria-label={t('login.totpTitle')} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
              <button className="btn sm" disabled={code.length !== 6} onClick={() => act(async () => { await api.post('/me/totp/enable', { code }); setSetup(null); refreshMe(); }, true)}>{t('common.confirm')}</button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

export default function AdminApp() {
  const { t, me } = useApp();
  const [dash] = useLoad<any>(() => api.get('/admin/dashboard').catch(() => null));
  const q = dash?.kpi ? dash.kpi.open_reports + dash.kpi.pending_eco + dash.kpi.pending_spots + dash.kpi.pending_clubs : 0;
  const admin = me?.role === 'admin';
  const nav = [
    { to: '/admin', icon: 'chart', label: t('adm.dashboard') },
    { to: '/admin/moderation', icon: 'shield', label: t('adm.moderation'), badge: q },
    { to: '/admin/users', icon: 'users', label: t('adm.users') },
    { to: '/admin/runs', icon: 'runner', label: t('adm.runs') },
    { to: '/admin/clubs', icon: 'people', label: t('adm.clubs') },
    { to: '/admin/challenges', icon: 'trophy', label: t('adm.challenges') },
    ...(admin
      ? [
          { to: '/admin/points', icon: 'sliders', label: t('adm.points') },
          { to: '/admin/partners', icon: 'store', label: t('adm.partners') },
          { to: '/admin/rewards', icon: 'gift', label: t('adm.rewards') },
          { to: '/admin/campaigns', icon: 'megaphone', label: t('adm.campaigns') },
          { to: '/admin/content', icon: 'file', label: t('adm.content') },
          { to: '/admin/events', icon: 'ticket', label: t('adm.events') },
          { to: '/admin/audit', icon: 'list', label: t('adm.audit') },
        ]
      : []),
    { to: '/admin/security', icon: 'lock', label: t('adm.security') },
  ];
  return (
    <CabinetLayout title={t('adm.title')} nav={nav}>
      <Routes>
        <Route index element={<Dashboard />} />
        <Route path="moderation" element={<Moderation />} />
        <Route path="users" element={<Users />} />
        <Route path="runs" element={<Runs />} />
        <Route path="clubs" element={<Clubs />} />
        <Route path="challenges" element={<Challenges />} />
        <Route path="points" element={<PointsSettings />} />
        <Route path="partners" element={<Partners />} />
        <Route path="rewards" element={<Rewards />} />
        <Route path="campaigns" element={<Campaigns />} />
        <Route path="content" element={<Content />} />
        <Route path="events" element={<Events />} />
        <Route path="audit" element={<Audit />} />
        <Route path="security" element={<Security />} />
      </Routes>
    </CabinetLayout>
  );
}
