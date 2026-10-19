import { useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { api } from '../api.ts';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Loading, PhotoInput, Sheet } from '../ui/ui.tsx';
import { BarChart, CabHead, CabinetLayout, Kpi } from '../cabinet.tsx';
import { QrScanner } from '../components/Qr.tsx';

export function RewardEditor({ value, partners, onClose, onSaved }: { value: any; partners?: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const { t, toast, errorText } = useApp();
  const [f, setF] = useState<any>(null);
  useEffect(() => {
    setF(value ? { category: 'cafe', active: true, stock: 10, points_price: 50, ...value, branchesText: (value.branches ?? []).join(', ') } : null);
  }, [value]);
  if (!f) return null;
  const set = (k: string, v: any) => setF({ ...f, [k]: v });
  const save = async () => {
    const body: any = {
      title: f.title, description: f.description || null, terms: f.terms || null, photo_url: f.photo_url || null, category: f.category,
      points_price: Number(f.points_price), stock: Number(f.stock), valid_until: f.valid_until ? String(f.valid_until).slice(0, 10) : null,
      branches: String(f.branchesText).split(',').map((s: string) => s.trim()).filter(Boolean), active: Boolean(f.active),
    };
    try {
      if (f.id) await api.patch(`/partner/rewards/${f.id}`, body);
      else await api.post('/partner/rewards', { ...body, ...(f.partner_id ? { partner_id: f.partner_id } : {}) });
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Sheet open onClose={onClose} title={f.id ? t('pt.edit') : t('pt.create')} right={<button className="btn plain" disabled={!f.title} onClick={save}>{t('pt.save')}</button>}>
      <div className="cab col" style={{ display: 'flex', minHeight: 0, background: 'none', gap: 12 }}>
        <div className="form-grid">
          {!f.id && partners && partners.length > 0 && (
            <label>{t('adm.partners')}<select className="inp" value={f.partner_id ?? ''} onChange={(e) => set('partner_id', e.target.value)}>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          )}
          <label>{t('adm.titleField')}<input className="inp" maxLength={120} value={f.title ?? ''} onChange={(e) => set('title', e.target.value)} /></label>
          <label>{t('pt.category')}<select className="inp" value={f.category} onChange={(e) => set('category', e.target.value)}>{['cafe', 'sport', 'gym', 'eco', 'other'].map((c) => <option key={c} value={c}>{t(`rw.cat.${c}`)}</option>)}</select></label>
          <label>{t('pt.price')}<input className="inp" type="number" min={1} value={f.points_price} onChange={(e) => set('points_price', e.target.value)} /></label>
          <label>{t('pt.stock')}<input className="inp" type="number" min={0} value={f.stock} onChange={(e) => set('stock', e.target.value)} /></label>
          <label>{t('pt.validUntil')}<input className="inp" type="date" value={f.valid_until ? String(f.valid_until).slice(0, 10) : ''} onChange={(e) => set('valid_until', e.target.value)} /></label>
          <label>{t('pt.active')}<select className="inp" value={String(f.active)} onChange={(e) => set('active', e.target.value === 'true')}><option value="true">✓</option><option value="false">—</option></select></label>
        </div>
        <label className="footnote">{t('rw.branches')} ({t('pt.branchesHint')})<input className="inp" value={f.branchesText} onChange={(e) => set('branchesText', e.target.value)} /></label>
        <label className="footnote">{t('pt.description')}<textarea className="inp" maxLength={2000} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} /></label>
        <label className="footnote">{t('pt.terms')}<textarea className="inp" maxLength={2000} value={f.terms ?? ''} onChange={(e) => set('terms', e.target.value)} /></label>
        <div style={{ maxWidth: 280 }}><PhotoInput value={f.photo_url ?? null} onChange={(u) => set('photo_url', u)} label={t('pt.photo')} /></div>
      </div>
    </Sheet>
  );
}

function usePartnerId() {
  const [pid, setPid] = useState<string>(() => {
    try {
      return localStorage.getItem('partnerId') ?? '';
    } catch {
      return '';
    }
  });
  const set = (v: string) => {
    setPid(v);
    try {
      localStorage.setItem('partnerId', v);
    } catch {
      /* ignore */
    }
  };
  return [pid, set] as const;
}

function Overview({ pid, setPid }: { pid: string; setPid: (v: string) => void }) {
  const { t, lang } = useApp();
  const [d, loading] = useLoad<any>(() => api.get(`/partner/overview${pid ? `?partner=${pid}` : ''}`), [pid]);
  if (loading || !d) return <Loading />;
  return (
    <>
      <CabHead title={d.partner.name}>
        {d.partners.length > 1 && (
          <select aria-label={t('adm.partners')} value={pid || d.partner.id} onChange={(e) => setPid(e.target.value)}>{d.partners.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        )}
      </CabHead>
      <div className="kpis">
        <Kpi label={t('pt.redeemed')} value={fmtNum(d.stats.redeemed, lang)} />
        <Kpi label={t('pt.redeemedMonth')} value={fmtNum(d.stats.redeemed_month, lang)} />
        <Kpi label={t('pt.outstanding')} value={fmtNum(d.stats.outstanding, lang)} />
        <Kpi label={t('pt.uniqueUsers')} value={fmtNum(d.stats.unique_users, lang)} />
        <Kpi label={t('pt.pointsTotal')} value={fmtNum(d.stats.points, lang)} />
      </div>
      <div className="kpi">
        <BarChart data={d.monthly.map((m: any) => ({ x: `${m.month}-01`, y: Number(m.redemptions) }))} label={t('pt.monthly')} valueLabel={t('pt.redeemed')} />
      </div>
      <div className="table-box"><table className="tbl">
        <thead><tr><th>{t('pt.month')}</th><th>{t('pt.redeemed')}</th><th>{t('pt.users')}</th></tr></thead>
        <tbody>{d.monthly.map((m: any) => <tr key={m.month}><td>{m.month}</td><td>{m.redemptions}</td><td>{m.users}</td></tr>)}</tbody>
      </table></div>
    </>
  );
}

function Rewards({ pid }: { pid: string }) {
  const { t, lang } = useApp();
  const [rows, loading, , reload] = useLoad<any[]>(() => api.get(`/partner/rewards${pid ? `?partner=${pid}` : ''}`), [pid]);
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <CabHead title={t('pt.rewards')}><button className="btn sm" onClick={() => setEdit({ partner_id: pid || undefined })}><Icon name="plus" size={16} /> {t('pt.create')}</button></CabHead>
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('adm.titleField')}</th><th>{t('pt.price')}</th><th>{t('pt.stock')}</th><th>{t('pt.outstanding')}</th><th>{t('pt.redeemed')}</th><th>{t('pt.validUntil')}</th><th /></tr></thead>
          <tbody>{rows?.map((r) => (
            <tr key={r.id}>
              <td>{r.title} {!r.active && <span className="badge">{t('pt.inactive')}</span>}<div className="caption">{t(`rw.cat.${r.category}`)}</div></td>
              <td>{r.points_price}</td><td><b>{r.stock}</b></td><td>{r.outstanding}</td><td>{r.redeemed}</td><td>{r.valid_until ? fmtDate(r.valid_until, lang) : '—'}</td>
              <td><button className="btn sm gray" onClick={() => setEdit(r)}>{t('common.edit')}</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <RewardEditor value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </>
  );
}

function Scan() {
  const { t, lang, toast, errorText } = useApp();
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [cam, setCam] = useState(false);
  const [branch, setBranch] = useState('');
  const [done, setDone] = useState<any>(null);
  const check = async (c = code) => {
    setDone(null);
    try {
      setInfo(await api.post('/partner/redeem/check', { code: c }));
    } catch (e) {
      setInfo(null);
      toast(errorText(e), 'error');
    }
  };
  const confirm = async () => {
    try {
      const r = await api.post('/partner/redeem', { code: info.code, branch: branch || null });
      setDone(r);
      setInfo(null);
      setCode('');
      navigator.vibrate?.([30, 50, 30]);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <>
      <CabHead title={t('pt.scan')} />
      <section className="kpi" style={{ gap: 12, maxWidth: 520 }}>
        <form className="toolbar" onSubmit={(e) => { e.preventDefault(); check(); }}>
          <label className="sr-only" htmlFor="pt-code">{t('pt.enterCode')}</label>
          <input id="pt-code" className="code-big" style={{ fontSize: 24, minHeight: 52, width: 260, textAlign: 'center' }} placeholder={t('pt.enterCode')} value={code} maxLength={12} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoFocus />
          <button className="btn" disabled={code.length < 6}>{t('pt.check')}</button>
        </form>
        {!cam ? <button className="btn tinted" onClick={() => setCam(true)}><Icon name="scan" size={18} /> {t('pt.camera')}</button> : (
          <QrScanner onClose={() => setCam(false)} onResult={(txt) => { setCam(false); const c = txt.replace(/^ECORUN:REWARD:/, ''); setCode(c); check(c); }} />
        )}
        {info && (
          <div className="card" style={{ background: 'var(--accent-tint)' }}>
            <span className="headline accent"><Icon name="checkCircle" size={18} /> {t('pt.valid')}</span>
            <span className="title3">{info.title}</span>
            <span className="sub">{t('pt.user')}: {info.user_name} · {info.points_spent} {t('common.pts')} · {t('rw.codeExpires', { d: fmtDate(info.expires_at, lang) })}</span>
            <label className="footnote">{t('pt.branch')}<input className="inp" value={branch} onChange={(e) => setBranch(e.target.value)} /></label>
            <button className="btn" onClick={confirm}>{t('pt.confirm')}</button>
          </div>
        )}
        {done && <div className="card"><span className="title3 accent"><Icon name="checkCircle" size={22} /> {done.title}</span><span>{t('pt.done', { n: done.stock_left })}</span></div>}
      </section>
    </>
  );
}

function History({ pid }: { pid: string }) {
  const { t, lang } = useApp();
  const [rows, loading] = useLoad<any[]>(() => api.get(`/partner/redemptions${pid ? `?partner=${pid}` : ''}`), [pid]);
  return (
    <>
      <CabHead title={t('pt.history')} />
      {loading ? <Loading /> : (
        <div className="table-box"><table className="tbl">
          <thead><tr><th>{t('pt.date')}</th><th>{t('pt.code')}</th><th>{t('adm.titleField')}</th><th>{t('pt.user')}</th><th>{t('pt.branch')}</th><th>{t('pt.staff')}</th><th>{t('adm.status')}</th></tr></thead>
          <tbody>{rows?.map((r) => (
            <tr key={r.id}><td>{fmtDateTime(r.redeemed_at ?? r.created_at, lang)}</td><td><code>{r.code}</code></td><td>{r.title}</td><td>{r.user_name}</td><td>{r.branch ?? '—'}</td><td>{r.staff_name ?? '—'}</td>
              <td><span className={`badge ${r.status === 'redeemed' ? 'green' : r.status === 'issued' ? 'orange' : ''}`}>{r.status}</span></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

function Challenges({ pid }: { pid: string }) {
  const { t, lang, toast, errorText } = useApp();
  const [d, , , reload] = useLoad<any>(() => api.get(`/partner/overview${pid ? `?partner=${pid}` : ''}`), [pid]);
  const [f, setF] = useState<any>({ title: '', metric: 'km', target: 30, reward_points: 50, reward_text: '', starts: new Date().toISOString().slice(0, 10), ends: new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10) });
  const send = async () => {
    try {
      await api.post('/partner/challenges', {
        title: f.title, metric: f.metric, target: Number(f.target), reward_points: Number(f.reward_points), reward_text: f.reward_text || null,
        starts_at: new Date(`${f.starts}T00:00:00+05:00`).toISOString(), ends_at: new Date(`${f.ends}T23:59:00+05:00`).toISOString(), ...(pid ? { partner_id: pid } : {}),
      });
      toast(t('pt.waiting'));
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <>
      <CabHead title={t('pt.challenges')} />
      <div className="table-box"><table className="tbl">
        <thead><tr><th>{t('adm.titleField')}</th><th>{t('adm.ends')}</th><th>{t('pt.reach')}</th><th>{t('pt.completed')}</th></tr></thead>
        <tbody>{d?.sponsored.map((c: any) => <tr key={c.id}><td>{c.title?.[lang] ?? c.title?.en}</td><td>{fmtDate(c.ends_at, lang)}</td><td>{c.participants}</td><td>{c.completed}</td></tr>)}</tbody>
      </table></div>
      <section className="kpi" style={{ gap: 12 }}>
        <h2 className="title3">{t('pt.newChallenge')}</h2>
        <p className="footnote">{t('pt.challengeNote')}</p>
        <div className="form-grid">
          <label>{t('adm.titleField')}<input className="inp" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
          <label>{t('adm.metric')}<select className="inp" value={f.metric} onChange={(e) => setF({ ...f, metric: e.target.value })}>{['km', 'runs', 'group_runs', 'plogging_runs', 'eco_points'].map((m) => <option key={m} value={m}>{t(`ch.metric.${m}`)}</option>)}</select></label>
          <label>{t('adm.targetValue')}<input className="inp" type="number" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} /></label>
          <label>{t('adm.rewardPoints')}<input className="inp" type="number" value={f.reward_points} onChange={(e) => setF({ ...f, reward_points: e.target.value })} /></label>
          <label>{t('adm.starts')}<input className="inp" type="date" value={f.starts} onChange={(e) => setF({ ...f, starts: e.target.value })} /></label>
          <label>{t('adm.ends')}<input className="inp" type="date" value={f.ends} onChange={(e) => setF({ ...f, ends: e.target.value })} /></label>
          <label>{t('ch.reward', { n: '' })}<input className="inp" value={f.reward_text} onChange={(e) => setF({ ...f, reward_text: e.target.value })} /></label>
        </div>
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} disabled={f.title.length < 3} onClick={send}>{t('common.send')}</button>
      </section>
    </>
  );
}

export default function PartnerApp() {
  const { t } = useApp();
  const [pid, setPid] = usePartnerId();
  const nav = [
    { to: '/partner', icon: 'chart', label: t('pt.overview') },
    { to: '/partner/scan', icon: 'scan', label: t('pt.scan') },
    { to: '/partner/rewards', icon: 'gift', label: t('pt.rewards') },
    { to: '/partner/history', icon: 'list', label: t('pt.history') },
    { to: '/partner/challenges', icon: 'trophy', label: t('pt.challenges') },
  ];
  return (
    <CabinetLayout title={t('pt.title')} nav={nav}>
      <Routes>
        <Route index element={<Overview pid={pid} setPid={setPid} />} />
        <Route path="scan" element={<Scan />} />
        <Route path="rewards" element={<Rewards pid={pid} />} />
        <Route path="history" element={<History pid={pid} />} />
        <Route path="challenges" element={<Challenges pid={pid} />} />
      </Routes>
    </CabinetLayout>
  );
}
