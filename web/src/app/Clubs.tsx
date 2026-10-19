import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { fmtWhen } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Avatar, Empty, ErrorBox, List, Loading, NavBar, PhotoInput, Row, TypeBadge } from '../ui/ui.tsx';
import { ReportSheet } from './Social.tsx';

export function ClubLogo({ club, size = 44 }: { club: { name: string; logo_url?: string | null }; size?: number }) {
  if (club.logo_url) return <img src={assetUrl(club.logo_url)} alt="" style={{ width: size, height: size, borderRadius: size / 4, objectFit: 'cover' }} />;
  return (
    <span className="tile" style={{ width: size, height: size, borderRadius: size / 4, background: 'linear-gradient(135deg,#1e7a38,#0066cc)', fontWeight: 700, fontSize: size * 0.4 }} aria-hidden="true">
      {club.name.slice(0, 1)}
    </span>
  );
}

export function Clubs() {
  const { t, me } = useApp();
  const [q, setQ] = useState('');
  const [items, loading, error, reload] = useLoad<any[]>(() => api.get(`/clubs${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q, me?.id]);
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('cl.title')} right={me && <Link className="icon-btn accent" to="/clubs/new" aria-label={t('cl.create')}><Icon name="plus" size={20} /></Link>} />
      <label className="sr-only" htmlFor="club-q">{t('common.search')}</label>
      <input id="club-q" className="input-big" style={{ fontSize: 17, minHeight: 44 }} placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {loading && !items ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : !items?.length ? <Empty icon="people" text={t('cl.empty')} /> : (
        <List>
          {items.map((c) => (
            <Row
              key={c.id}
              to={`/clubs/${c.id}`}
              leading={<ClubLogo club={c} size={44} />}
              title={<span className="row-flex" style={{ gap: 6 }}>{c.name}{c.verified && <Icon name="checkCircle" size={16} className="accent" title={t('cl.verified')} />}</span>}
              subtitle={[t('cl.members', { n: c.members }), c.district, c.schedule_text].filter(Boolean).join(' · ')}
              value={c.my_role ? <span className="badge green">{t(c.my_role === 'member' ? 'cl.member' : `cl.${c.my_role}`)}</span> : undefined}
            />
          ))}
        </List>
      )}
    </main>
  );
}

export function ClubDetail() {
  const { id } = useParams();
  const { t, lang, me, refreshMe, toast, errorText } = useApp();
  const [c, loading, error, reload] = useLoad<any>(() => api.get(`/clubs/${id}`), [id, me?.id]);
  const [report, setReport] = useState(false);
  if (loading) return <main className="screen no-tab"><NavBar back /><Loading /></main>;
  if (error || !c) return <main className="screen no-tab"><NavBar back /><ErrorBox error={error} retry={reload} /></main>;
  const act = async (fn: () => Promise<any>) => {
    try {
      await fn();
      reload();
      refreshMe();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const manager = c.my_role === 'owner' || c.my_role === 'co_organizer';
  return (
    <main className="screen no-tab tight">
      <NavBar back right={me && !manager && <button className="icon-btn" aria-label={t('rp.title')} onClick={() => setReport(true)}><Icon name="flag" size={20} /></button>} />
      {c.cover_url && <img className="cover" src={assetUrl(c.cover_url)} alt="" />}
      <section className="card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <ClubLogo club={c} size={80} />
        <h1 className="title2 row-flex" style={{ gap: 6 }}>{c.name}{c.verified && <Icon name="checkCircle" size={22} className="accent" title={t('cl.verified')} />}</h1>
        <span className="sub">{[t('cl.members', { n: c.members }), c.district].filter(Boolean).join(' · ')}</span>
        {me && !c.my_role && <button className="btn block" onClick={() => act(() => api.post(`/clubs/${c.id}/join`))}>{t('cl.join')}</button>}
        {me && c.my_role === 'member' && <button className="btn block gray" onClick={() => act(() => api.post(`/clubs/${c.id}/leave`))}>{t('cl.leave')}</button>}
        {manager && (
          <div className="btn-row" style={{ width: '100%' }}>
            <Link className="btn" to={`/runs/new?club=${c.id}`}><Icon name="plus" size={18} /> {t('runs.create')}</Link>
            <Link className="btn tinted" to={`/organizer/clubs/${c.id}`}>{t('cl.manage')}</Link>
          </div>
        )}
      </section>
      {c.description && <section className="card pad-sm"><h2 className="group-label" style={{ padding: 0 }}>{t('cl.about')}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{c.description}</p></section>}
      <List>
        {c.schedule_text && <Row icon="calendar" tile="#0066cc" title={t('cl.schedule')} subtitle={c.schedule_text} />}
        {c.address && <Row icon="pin" tile="#d70015" title={c.address} />}
        {c.telegram_link && <Row icon="telegram" tile="#2AABEE" title="Telegram" onClick={() => window.open(c.telegram_link, '_blank', 'noopener')} chevron />}
        {c.instagram && <Row icon="image" tile="#c13584" title={`@${c.instagram}`} onClick={() => window.open(`https://instagram.com/${c.instagram}`, '_blank', 'noopener')} chevron />}
      </List>
      <List label={t('cl.upcoming')}>
        {c.runs.length ? c.runs.map((r: any) => (
          <Row key={r.id} to={`/runs/${r.id}`} icon="runner" title={r.title} subtitle={`${fmtWhen(r.start_at, lang, t)}${r.distance_km ? ` · ${r.distance_km} ${t('common.km')}` : ''}`} trailing={<TypeBadge type={r.type} />} />
        )) : <Row title={<span className="muted">{t('cl.noRuns')}</span>} />}
      </List>
      {c.photos.length > 0 && (
        <section className="section">
          <h2 className="group-label">{t('cl.gallery')}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {c.photos.map((p: any) => <img key={p.id} src={assetUrl(p.url)} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10 }} />)}
          </div>
        </section>
      )}
      <List label={`${t('cl.membersTitle')} · ${c.members}`}>
        {c.members_list.slice(0, 30).map((m: any) => (
          <Row key={m.id} to={`/users/${m.id}`} leading={<Avatar src={m.photo_url} name={m.name} size={32} />} title={m.name} value={m.role !== 'member' ? t(`cl.${m.role}`) : undefined} />
        ))}
      </List>
      <ReportSheet open={report} onClose={() => setReport(false)} targetType="club" targetId={c.id} />
    </main>
  );
}

export function ClubForm() {
  const { t, refreshMe, toast, errorText } = useApp();
  const nav = useNavigate();
  const [meta] = useLoad<any>(() => api.get('/meta'));
  const [f, setF] = useState({ name: '', description: '', district: '', schedule_text: '', logo_url: null as string | null, telegram_link: '' });
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      const r = await api.post('/clubs', { ...f, name: f.name.trim(), district: f.district || null, telegram_link: f.telegram_link.trim() || null });
      await refreshMe();
      toast(t('cl.created'));
      nav(`/clubs/${r.id}`, { replace: true });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('cl.create')} />
      <div style={{ width: 140, alignSelf: 'center' }}><PhotoInput value={f.logo_url} onChange={(u) => set('logo_url', u)} label="Logo" /></div>
      <ul className="field-list">
        <li className="field stack"><label htmlFor="cf-name">{t('cl.name')}</label><input id="cf-name" maxLength={80} value={f.name} onChange={(e) => set('name', e.target.value)} /></li>
        <li className="field">
          <label htmlFor="cf-district">{t('ob.district')}</label>
          <select id="cf-district" value={f.district} onChange={(e) => set('district', e.target.value)}>
            <option value="">—</option>
            {meta?.districts.map((d: string) => <option key={d}>{d}</option>)}
          </select>
        </li>
        <li className="field stack"><label htmlFor="cf-sched">{t('cl.schedule')}</label><input id="cf-sched" maxLength={300} value={f.schedule_text} onChange={(e) => set('schedule_text', e.target.value)} /></li>
        <li className="field stack"><label htmlFor="cf-tg">Telegram</label><input id="cf-tg" maxLength={120} placeholder="https://t.me/…" value={f.telegram_link} onChange={(e) => set('telegram_link', e.target.value)} /></li>
        <li className="field stack"><label htmlFor="cf-desc">{t('cl.about')}</label><textarea id="cf-desc" maxLength={3000} value={f.description} onChange={(e) => set('description', e.target.value)} /></li>
      </ul>
      <button className="btn block" disabled={f.name.trim().length < 2} onClick={save}>{t('common.create')}</button>
    </main>
  );
}
