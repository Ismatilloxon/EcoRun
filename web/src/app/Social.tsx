import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, onRealtime } from '../api.ts';
import { fmtDuration, fmtKm, fmtNum, fmtPace, fmtRelative, fmtTime, fmtWhen } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Avatar, Chips, Confirm, Empty, ErrorBox, List, Loading, NavBar, Row, Sheet } from '../ui/ui.tsx';

export function ReportSheet({ open, onClose, targetType, targetId }: { open: boolean; onClose: () => void; targetType: string; targetId: string }) {
  const { t, toast, errorText } = useApp();
  const [reason, setReason] = useState<string | null>('spam');
  const [details, setDetails] = useState('');
  const send = async () => {
    try {
      await api.post('/reports', { target_type: targetType, target_id: targetId, reason, details: details.trim() || undefined });
      toast(t('rp.sent'));
      onClose();
      setDetails('');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('rp.title')}>
      <section className="col" style={{ gap: 8 }}>
        <h3 className="group-label">{t('rp.reason')}</h3>
        <Chips value={reason} onChange={setReason} options={['spam', 'abuse', 'fake', 'unsafe', 'inappropriate', 'other'].map((r) => ({ value: r, label: t(`rp.r.${r}`) }))} wrap label={t('rp.reason')} />
      </section>
      <ul className="field-list">
        <li className="field stack">
          <label htmlFor="rp-details">{t('rp.details')}</label>
          <textarea id="rp-details" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
        </li>
      </ul>
      <button className="btn block danger" disabled={!reason} onClick={send}>{t('common.send')}</button>
    </Sheet>
  );
}

export function UserProfile() {
  const { id } = useParams();
  const { t, lang, me, toast, errorText } = useApp();
  const nav = useNavigate();
  const [u, loading, error, reload] = useLoad<any>(() => api.get(`/users/${id}`), [id, me?.id]);
  const [menu, setMenu] = useState(false);
  const [block, setBlock] = useState(false);
  const [report, setReport] = useState(false);
  useEffect(() => {
    if (me && id === me.id) nav('/profile', { replace: true });
  }, [me, id, nav]);
  if (loading) return <main className="screen no-tab"><NavBar back /><Loading /></main>;
  if (error || !u) return <main className="screen no-tab"><NavBar back /><ErrorBox error={error} retry={reload} /></main>;
  const act = async (fn: () => Promise<any>) => {
    try {
      await fn();
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <main className="screen no-tab tight">
      <NavBar back right={me && <button className="icon-btn" aria-label={t('common.more')} onClick={() => setMenu(true)}><Icon name="more" size={22} stroke={3} /></button>} />
      <section className="card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Avatar src={u.photo_url} name={u.name} size={88} />
        <h1 className="title2">{u.name}</h1>
        <div className="row-flex wrap" style={{ gap: 6, justifyContent: 'center' }}>
          <span className="badge green">{t('pr.level', { n: u.points.level })}</span>
          {u.level && <span className="badge">{t(`level.${u.level}`)}</span>}
          {u.district && <span className="badge">{u.district}</span>}
          {u.strava_verified && <span className="badge orange">{t('pr.verified')}</span>}
          {u.follows_you && <span className="badge blue">{t('us.followsYou')}</span>}
        </div>
        <div className="grid3" style={{ width: '100%' }}>
          <div className="stat"><span className="v">{u.followers}</span><span className="l">{t('pr.followers')}</span></div>
          <div className="stat"><span className="v">{u.following}</span><span className="l">{t('pr.following')}</span></div>
          <div className="stat"><span className="v">{fmtNum(u.points.earned, lang)}</span><span className="l">{t('pr.points')}</span></div>
        </div>
        {me ? (
          <div className="btn-row" style={{ width: '100%' }}>
            {u.is_following ? (
              <button className="btn gray" onClick={() => act(() => api.del(`/users/${u.id}/follow`))}><Icon name="check" size={18} /> {t('us.unfollow')}</button>
            ) : (
              <button className="btn" onClick={() => act(() => api.post(`/users/${u.id}/follow`))}><Icon name="userPlus" size={18} /> {t('us.follow')}</button>
            )}
            <Link className="btn tinted" to={`/messages/${u.id}`}><Icon name="chat" size={18} /> {t('us.message')}</Link>
          </div>
        ) : (
          <Link className="btn block" to="/welcome">{t('common.signInToContinue')}</Link>
        )}
      </section>
      {!u.visible ? (
        <Empty icon="lock" text={t('us.private')} />
      ) : (
        <>
          <section className="card">
            <div className="grid3">
              <div className="stat"><span className="v">{fmtNum(u.stats.monthKm, lang)}</span><span className="l">{t('pr.month')}, {t('common.km')}</span></div>
              <div className="stat"><span className="v">{u.stats.runs}</span><span className="l">{t('pr.runs')}</span></div>
              <div className="stat"><span className="v">{u.stats.impact.bags}</span><span className="l">{t('impact.bags')}</span></div>
            </div>
          </section>
          {u.badges?.length > 0 && (
            <div className="chips wrap">{u.badges.map((b: any) => <span key={b.code} className="badge orange" style={{ padding: '6px 10px' }}><Icon name="medal" size={14} /> {b.title?.[lang] ?? b.title?.en}</span>)}</div>
          )}
          {u.clubs?.length > 0 && <List label={t('pr.clubs')}>{u.clubs.map((c: any) => <Row key={c.id} to={`/clubs/${c.id}`} icon="people" tile="#0066cc" title={c.name} />)}</List>}
          {u.activities?.length > 0 && (
            <List label={t('pr.activities')}>
              {u.activities.map((a: any) => (
                <Row key={a.id} to={`/activities/${a.id}`} icon={a.is_commute ? 'bolt' : 'runner'} title={`${fmtKm(a.distance_m, 1)} ${t('common.km')} · ${fmtDuration(a.duration_s)}`} subtitle={fmtWhen(a.started_at, lang, t)} value={`${fmtPace(a.avg_pace_s)}${t('common.perKm')}`} />
              ))}
            </List>
          )}
        </>
      )}
      <Sheet open={menu} onClose={() => setMenu(false)}>
        <div className="col" style={{ gap: 8 }}>
          <button className="btn danger" onClick={() => { setMenu(false); setReport(true); }}><Icon name="flag" size={18} /> {t('us.report')}</button>
          <button className="btn danger" onClick={() => { setMenu(false); setBlock(true); }}><Icon name="block" size={18} /> {t('us.block')}</button>
        </div>
      </Sheet>
      <Confirm open={block} onClose={() => setBlock(false)} danger text={t('us.blockConfirm', { name: u.name })} confirmLabel={t('us.block')} onConfirm={() => act(async () => { await api.post(`/users/${u.id}/block`); nav(-1); })} />
      <ReportSheet open={report} onClose={() => setReport(false)} targetType="user" targetId={u.id} />
    </main>
  );
}

export function Buddies() {
  const { t, toast, errorText } = useApp();
  const [items, loading, , reload] = useLoad<any[]>(() => api.get('/buddies'));
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('bd.title')} />
      <p className="footnote" style={{ padding: '0 4px' }}>{t('bd.why')}</p>
      {loading ? <Loading /> : !items?.length ? <Empty icon="people" text={t('bd.empty')} /> : (
        <List>
          {items.map((u) => (
            <Row
              key={u.id}
              to={`/users/${u.id}`}
              leading={<Avatar src={u.photo_url} name={u.name} size={40} />}
              title={u.name}
              subtitle={[u.district, u.level && t(`level.${u.level}`), u.pace_sec_per_km && `${fmtPace(u.pace_sec_per_km)}${t('common.perKm')}`, u.preferred_time && t(`time.${u.preferred_time}`)].filter(Boolean).join(' · ')}
              trailing={<button className="btn sm tinted" onClick={(e) => { e.preventDefault(); api.post(`/users/${u.id}/follow`).then(reload).catch((er) => toast(errorText(er), 'error')); }}>{t('us.follow')}</button>}
              chevron={false}
            />
          ))}
        </List>
      )}
    </main>
  );
}

export function Messages() {
  const { t, lang } = useApp();
  const [items, loading] = useLoad<any[]>(() => api.get('/dm'));
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('dm.title')} />
      {loading ? <Loading /> : !items?.length ? <Empty icon="chat" text={t('dm.empty')} /> : (
        <List>
          {items.map((c) => (
            <Row key={c.user_id} to={`/messages/${c.user_id}`} leading={<Avatar src={c.photo_url} name={c.name} size={44} />} title={<b>{c.name}</b>} subtitle={c.body} value={c.unread > 0 ? <span className="dot" style={{ position: 'static' }}>{c.unread}</span> : fmtRelative(c.created_at, lang)} />
          ))}
        </List>
      )}
    </main>
  );
}

export function Thread() {
  const { id } = useParams();
  const { t, lang, me, toast, errorText } = useApp();
  const [user] = useLoad<any>(() => api.get(`/users/${id}`), [id]);
  const [data, loading, , , setData] = useLoad<any>(() => api.get(`/dm/${id}`), [id]);
  const [text, setText] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const cur = useRef<any>(null);
  cur.current = data;
  useEffect(() => onRealtime((m) => m.type === 'dm' && m.from === id && cur.current && setData({ ...cur.current, messages: [...cur.current.messages, m.message] })), [id, setData]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages?.length]);
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const m = await api.post(`/dm/${id}`, { body });
      setData({ ...cur.current, messages: [...cur.current.messages, m] });
    } catch (e) {
      setText(body);
      toast(errorText(e), 'error');
    }
  };
  return (
    <main className="screen no-tab tight" style={{ paddingBottom: 0 }}>
      <NavBar back="/messages" title={user?.name ?? t('dm.title')} />
      {loading ? <Loading /> : (
        <div className="chat" style={{ flex: 1 }}>
          {!data?.messages?.length && <Empty icon="chat" text={data?.canMessage ? t('chat.empty') : t('dm.notAllowed')} />}
          {data?.messages?.map((m: any) => (
            <div key={m.id} className={`bubble ${m.sender_id === me?.id ? 'mine' : ''}`}>
              <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>
              <span className="caption" style={{ display: 'block', color: 'inherit', opacity: 0.7 }}>{fmtTime(m.created_at, lang)}</span>
            </div>
          ))}
          <div ref={bottom} />
        </div>
      )}
      {data?.canMessage ? (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <label className="sr-only" htmlFor="dm-input">{t('dm.placeholder')}</label>
          <textarea id="dm-input" rows={1} maxLength={2000} placeholder={t('dm.placeholder')} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="icon-btn" aria-label={t('common.send')} disabled={!text.trim()} style={{ background: 'var(--accent-bg)', color: '#fff', border: 0 }}><Icon name="send" size={20} /></button>
        </form>
      ) : data && <p className="footnote center" style={{ padding: 16 }}>{t('dm.notAllowed')}</p>}
    </main>
  );
}
