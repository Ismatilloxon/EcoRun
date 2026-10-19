import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.ts';
import { fmtDate, fmtDateTime, fmtDuration, fmtNum, fmtRelative } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Avatar, Empty, LargeTitle, List, Loading, NavBar, Progress, Row, Segmented } from '../ui/ui.tsx';
import { RunRow } from '../components/RunCard.tsx';
import { ImpactHero } from './Home.tsx';

async function shareImpactCard(impact: any, name: string, t: (k: string, v?: any) => string, lang: string) {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1920;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 1920);
  grad.addColorStop(0, '#1e7a38');
  grad.addColorStop(1, '#0f3d1c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1080, 1920);
  g.fillStyle = '#ffffff';
  g.font = '700 64px -apple-system, system-ui, sans-serif';
  g.fillText('EcoRun', 90, 180);
  g.font = '600 56px -apple-system, system-ui, sans-serif';
  g.fillText(t('impact.cardTitle'), 90, 330);
  g.font = '400 44px -apple-system, system-ui, sans-serif';
  g.globalAlpha = 0.85;
  g.fillText(name, 90, 400);
  g.globalAlpha = 1;
  const nf = new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : lang === 'en' ? 'en-GB' : 'uz-UZ');
  const rows = [
    [nf.format(impact.km), t('impact.km')],
    [nf.format(impact.kgWaste), t('impact.kg')],
    [nf.format(impact.co2Kg), t('impact.co2')],
    [nf.format(impact.trees), t('impact.trees')],
  ];
  rows.forEach(([v, l], i) => {
    const y = 640 + i * 280;
    g.font = '800 150px -apple-system, system-ui, sans-serif';
    g.fillText(String(v), 90, y);
    g.font = '500 48px -apple-system, system-ui, sans-serif';
    g.globalAlpha = 0.85;
    g.fillText(String(l), 90, y + 70);
    g.globalAlpha = 1;
  });
  g.font = '500 40px -apple-system, system-ui, sans-serif';
  g.fillText('#EcoRunTashkent', 90, 1800);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  const file = new File([blob], 'ecorun-impact.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: t('impact.cardTitle') }).catch(() => {});
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ecorun-impact.png';
    a.click();
  }
}

export function Profile() {
  const { t, lang, me, toast } = useApp();
  const [stats, loading] = useLoad<any>(() => api.get('/me/stats'), [me?.id]);
  const [meta] = useLoad<any>(() => api.get('/meta'));
  if (!me) return null;
  const p = me.points;
  const inviteUrl = `${location.origin}/welcome?invite=${me.invite_code}`;
  const invite = async () => {
    const text = t('pr.inviteText', { code: me.invite_code, url: inviteUrl });
    if (navigator.share) navigator.share({ text, url: inviteUrl }).catch(() => {});
    else {
      await navigator.clipboard?.writeText(text);
      toast(t('common.copied'));
    }
  };
  const isStaff = me.role === 'admin' || me.role === 'moderator';
  const isPartner = me.role === 'partner' || me.role === 'admin';
  const isOrg = me.clubs.some((c) => c.role !== 'member') || ['club_organizer', 'event_organizer', 'admin'].includes(me.role);

  return (
    <main className="screen">
      <LargeTitle title={t('pr.title')} right={<Link className="icon-btn" to="/settings" aria-label={t('pr.settings')}><Icon name="settings" size={22} /></Link>} />
      <section className="card" style={{ alignItems: 'center', textAlign: 'center' }}>
        <Avatar src={me.photo_url} name={me.name} size={88} />
        <div className="col" style={{ gap: 4, alignItems: 'center' }}>
          <h2 className="title2">{me.name}</h2>
          <div className="row-flex wrap" style={{ gap: 6, justifyContent: 'center' }}>
            <span className="badge green">{t('pr.level', { n: p.level })}</span>
            {me.level && <span className="badge">{t(`level.${me.level}`)}</span>}
            {me.district && <span className="badge">{me.district}</span>}
            {me.strava_verified && <span className="badge orange"><Icon name="checkCircle" size={12} /> {t('pr.verified')}</span>}
          </div>
        </div>
        <div className="grid3" style={{ width: '100%' }}>
          <Link to="/profile/points" className="stat" style={{ textDecoration: 'none', color: 'inherit' }}><span className="v accent">{fmtNum(p.balance, lang)}</span><span className="l">{t('pr.points')}</span></Link>
          <div className="stat"><span className="v">{me.followers}</span><span className="l">{t('pr.followers')}</span></div>
          <div className="stat"><span className="v">{me.following}</span><span className="l">{t('pr.following')}</span></div>
        </div>
        <div style={{ width: '100%' }} className="col">
          <Progress value={p.earned - p.current} max={(p.next ?? p.earned) - p.current || 1} label={t('pr.level', { n: p.level })} />
          <span className="footnote">{p.next ? t('pr.toNext', { n: p.next - p.earned, l: p.level + 1 }) : t('pr.maxLevel')}</span>
        </div>
        <Link className="btn sm gray" to="/profile/edit">{t('pr.edit')}</Link>
      </section>

      {loading ? <Loading /> : stats && (
        <>
          <section className="card">
            <h2 className="sub headline">{t('pr.stats')}</h2>
            <div className="grid3" style={{ rowGap: 16 }}>
              <div className="stat"><span className="v">{fmtNum(stats.weekKm, lang)}</span><span className="l">{t('pr.week')}, {t('common.km')}</span></div>
              <div className="stat"><span className="v">{fmtNum(stats.monthKm, lang)}</span><span className="l">{t('pr.month')}, {t('common.km')}</span></div>
              <div className="stat"><span className="v">{fmtNum(stats.totalKm, lang)}</span><span className="l">{t('pr.total')}</span></div>
              <div className="stat"><span className="v">{stats.runs}</span><span className="l">{t('pr.runs')}</span></div>
              <div className="stat"><span className="v">{stats.groupRuns}</span><span className="l">{t('pr.groupRuns')}</span></div>
              <div className="stat"><span className="v">{stats.streakWeeks}</span><span className="l">{t('pr.streak')}</span></div>
            </div>
          </section>
          <List label={t('pr.pbs')}>
            {(['1k', '5k', '10k', '21k'] as const).map((k) => (
              <Row key={k} icon="trophy" tile={stats.pbs[k] ? '#c93400' : '#8e8e93'} title={k.toUpperCase()} value={stats.pbs[k] ? fmtDuration(stats.pbs[k]) : '—'} />
            ))}
          </List>
          <ImpactHero impact={stats.impact} />
          <button className="btn block tinted" onClick={() => shareImpactCard(stats.impact, me.name ?? '', t, lang)}><Icon name="share" size={18} /> {t('impact.share')}</button>
          <section className="section">
            <h2 className="group-label">{t('pr.badges')} · {stats.badges.length}/{stats.allBadges.length}</h2>
            <div className="card pad-sm" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {stats.badges.length ? stats.badges.map((b: any) => (
                <div key={b.code} className="col" style={{ alignItems: 'center', gap: 4, textAlign: 'center' }} title={b.description?.[lang]}>
                  <span className="tile lg" style={{ background: 'linear-gradient(135deg,#c93400,#f0a030)', borderRadius: '50%' }}><Icon name={b.icon === 'shoe' ? 'shoe' : b.icon} size={22} /></span>
                  <span className="caption" style={{ color: 'var(--label)' }}>{b.title?.[lang] ?? b.title?.en}</span>
                </div>
              )) : <span className="footnote" style={{ gridColumn: '1 / -1' }}>—</span>}
            </div>
          </section>
        </>
      )}

      <section className="card pad-sm">
        <div className="row-flex">
          <span className="tile lg" style={{ background: '#7d3cc9' }}><Icon name="userPlus" size={22} /></span>
          <div className="grow col" style={{ gap: 2 }}>
            <span className="headline">{t('pr.invite')}</span>
            <span className="footnote">{t('pr.inviteBody', { n: meta?.points?.invite ?? 25 })}</span>
          </div>
        </div>
        <button className="btn tinted" onClick={invite}>{t('pr.inviteCode', { code: me.invite_code })} · <Icon name="share" size={16} /></button>
      </section>

      <List>
        <Row to="/profile/points" icon="leaf" title={t('pr.history')} value={p.pending ? t('rw.pending', { n: p.pending }) : undefined} />
        <Row to="/profile/runs" icon="calendar" tile="#0066cc" title={t('pr.myRuns')} />
        <Row to="/record" icon="runner" tile="#c93400" title={t('pr.activities')} />
        <Row to="/eco/history" icon="bag" tile="#8a5a00" title={t('pr.ecoHistory')} />
        <Row to="/rewards/codes" icon="qr" tile="#000" title={t('rw.myCodes')} />
      </List>
      <List>
        <Row to="/leaderboard" icon="trophy" tile="#c93400" title={t('pr.leaderboard')} />
        <Row to="/challenges" icon="flag" tile="#7d3cc9" title={t('pr.challenges')} />
        <Row to="/clubs" icon="people" tile="#0066cc" title={t('pr.clubs')} value={me.clubs.length || undefined} />
        <Row to="/buddies" icon="userPlus" tile="var(--accent-bg)" title={t('pr.buddies')} />
        <Row to="/messages" icon="chat" tile="#34c759" title={t('pr.messages')} />
        <Row to="/events" icon="ticket" tile="#d70015" title={t('pr.events')} />
        <Row to="/eco/spots" icon="pin" tile="#d70015" title={t('pr.spots')} />
        <Row to="/eco/donate" icon="tree" tile="var(--accent-bg)" title={t('pr.donate')} />
        <Row to="/notifications" icon="bell" tile="#ff9500" title={t('pr.notifications')} />
      </List>
      {(isStaff || isPartner || isOrg) && (
        <List label={t('pr.cabinets')}>
          {isStaff && <Row to="/admin" icon="shield" tile="#000" title={t('pr.admin')} />}
          {isPartner && <Row to="/partner" icon="store" tile="#7d3cc9" title={t('pr.partner')} />}
          {isOrg && <Row to="/organizer" icon="flag" tile="#0066cc" title={t('pr.organizer')} />}
        </List>
      )}
    </main>
  );
}

export function PointsHistory() {
  const { t, lang } = useApp();
  const [data, loading] = useLoad<any>(() => api.get('/me/points'));
  return (
    <main className="screen no-tab tight">
      <NavBar back="/profile" title={t('pr.history')} />
      {loading ? <Loading /> : data && (
        <>
          <section className="card" style={{ flexDirection: 'row', justifyContent: 'space-around', textAlign: 'center' }}>
            <div className="stat"><span className="v accent">{fmtNum(data.balance, lang)}</span><span className="l">{t('rw.balance')}</span></div>
            <div className="stat"><span className="v">{fmtNum(data.pending, lang)}</span><span className="l">{t('pstatus.pending')}</span></div>
            <div className="stat"><span className="v">{t('pr.level', { n: data.level })}</span><span className="l">{fmtNum(data.earned, lang)}</span></div>
          </section>
          {!data.items.length ? <Empty icon="leaf" text="—" /> : (
            <List>
              {data.items.map((i: any) => (
                <Row
                  key={i.id}
                  icon={i.amount < 0 ? 'gift' : 'leaf'}
                  tile={i.status === 'rejected' ? '#8e8e93' : i.amount < 0 ? '#c93400' : 'var(--accent-bg)'}
                  title={t(`reason.${i.reason}`)}
                  subtitle={`${fmtDateTime(i.created_at, lang)} · ${t(`pstatus.${i.status}`)}${i.note === 'cap_reached' ? ` · ${t('note.cap_reached')}` : i.note?.startsWith('capped') ? ` · ${t('note.capped')}` : ''}`}
                  value={<span style={{ fontWeight: 600, color: i.status === 'rejected' ? 'var(--label-3)' : i.amount < 0 ? 'var(--orange)' : 'var(--accent)', textDecoration: i.status === 'rejected' ? 'line-through' : undefined }}>{i.amount > 0 ? '+' : ''}{i.amount}</span>}
                />
              ))}
            </List>
          )}
        </>
      )}
    </main>
  );
}

export function MyRuns() {
  const { t } = useApp();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [data, loading] = useLoad<any>(() => api.get('/runs/mine'));
  const items = data?.[tab] ?? [];
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('pr.myRuns')} right={<Link className="icon-btn accent" to="/runs/new" aria-label={t('runs.create')}><Icon name="plus" size={20} /></Link>} />
      <Segmented value={tab} onChange={setTab} options={[{ value: 'upcoming', label: t('runs.upcoming') }, { value: 'past', label: t('runs.past') }]} label={t('pr.myRuns')} />
      {loading ? <Loading /> : !items.length ? <Empty icon="calendar" text={t('home.noNext')} action={<Link className="btn sm" to="/runs">{t('home.findRun')}</Link>} /> : <List round>{items.map((r: any) => <RunRow key={r.id} run={r} />)}</List>}
    </main>
  );
}

export function Leaderboard() {
  const { t, lang, me } = useApp();
  const [period, setPeriod] = useState<'week' | 'month' | 'all'>('month');
  const [metric, setMetric] = useState<'km' | 'points'>('km');
  const [data, loading] = useLoad<any>(() => api.get(`/leaderboard?period=${period}&metric=${metric}`), [period, metric]);
  const unit = metric === 'km' ? t('common.km') : t('common.pts');
  return (
    <main className="screen">
      <LargeTitle title={t('lb.title')} />
      <Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: t('lb.week') }, { value: 'month', label: t('lb.month') }, { value: 'all', label: t('lb.all') }]} label={t('lb.title')} />
      <Segmented value={metric} onChange={setMetric} options={[{ value: 'km', label: t('lb.km') }, { value: 'points', label: t('lb.points') }]} label={t('lb.title')} />
      {data?.mine && (
        <section className="card pad-sm" style={{ flexDirection: 'row', alignItems: 'center', background: 'var(--accent-tint)' }}>
          <span className="rank top">#{data.mine.rank}</span>
          <Avatar src={me?.photo_url} name={me?.name} size={36} />
          <span className="grow headline">{t('lb.you')}</span>
          <span className="headline accent">{fmtNum(data.mine.value, lang)} {unit}</span>
        </section>
      )}
      {loading ? <Loading /> : !data?.rows.length ? <Empty icon="trophy" text={t('lb.empty')} /> : (
        <List>
          {data.rows.map((r: any) => (
            <Row
              key={r.id}
              to={`/users/${r.id}`}
              leading={<span className="row-flex" style={{ gap: 10 }}><span className={`rank ${r.rank <= 3 ? 'top' : ''}`}>{r.rank}</span><Avatar src={r.photo_url} name={r.name} size={36} /></span>}
              title={r.name}
              subtitle={r.district}
              value={<b style={{ color: 'var(--label)' }}>{fmtNum(r.value, lang)} {unit}</b>}
              chevron={false}
            />
          ))}
        </List>
      )}
    </main>
  );
}

export function Challenges() {
  const { t, me, toast, errorText } = useApp();
  const [items, loading, , reload] = useLoad<any[]>(() => api.get('/challenges'), [me?.id]);
  return (
    <main className="screen">
      <LargeTitle title={t('ch.title')} />
      {loading ? <Loading /> : !items?.length ? <Empty icon="flag" text={t('ch.empty')} /> : (
        <div className="col" style={{ gap: 12 }}>
          {items.map((c) => (
            <ChallengeCardWide key={c.id} c={c} onJoin={me ? async () => { try { await api.post(`/challenges/${c.id}/join`); reload(); } catch (e) { toast(errorText(e), 'error'); } } : undefined} />
          ))}
        </div>
      )}
    </main>
  );
}

function ChallengeCardWide({ c, onJoin }: { c: any; onJoin?: () => void }) {
  const { t, lang } = useApp();
  return (
    <section className="card">
      <div className="row-flex" style={{ alignItems: 'flex-start' }}>
        <span className="tile lg" style={{ background: c.completed_at ? '#34c759' : 'var(--orange)' }}><Icon name="trophy" size={24} /></span>
        <div className="grow col" style={{ gap: 2 }}>
          <span className="title3">{c.title}</span>
          <span className="sub">{c.description}</span>
        </div>
      </div>
      <div className="row-flex wrap" style={{ gap: 6 }}>
        <span className="badge green">{t('ch.reward', { n: c.reward_points })}</span>
        {c.reward_text && <span className="badge orange">{c.reward_text}</span>}
        {c.sponsor_name && <span className="badge blue">{t('ch.sponsor', { name: c.sponsor_name })}</span>}
        <span className="badge">{t('ch.ends', { d: fmtDate(c.ends_at, lang, { day: 'numeric', month: 'short' }) })}</span>
        <span className="badge">{t('ch.participants', { n: c.participants })}</span>
      </div>
      {c.joined ? (
        <>
          <Progress value={Number(c.progress ?? 0)} max={Number(c.target)} label={c.title} />
          <span className="footnote">{c.completed_at ? t('ch.completed') : t('ch.progress', { p: c.progress ?? 0, t: `${c.target} ${t(`ch.metric.${c.metric}`)}` })}</span>
        </>
      ) : onJoin ? (
        <button className="btn" onClick={onJoin}>{t('ch.join')}</button>
      ) : null}
    </section>
  );
}

export function Notifications() {
  const { t, lang, setUnread } = useApp();
  const nav = useNavigate();
  const [items, loading, , reload] = useLoad<any[]>(() => api.get('/me/notifications'));
  const markRead = async () => {
    await api.post('/me/notifications/read');
    setUnread(0);
    reload();
  };
  const target = (n: any) => (n.data?.run ? `/runs/${n.data.run}` : n.data?.reward ? `/rewards/${n.data.reward}` : n.data?.dm ? `/messages/${n.data.dm}` : n.data?.eco ? '/eco/history' : n.data?.user ? `/users/${n.data.user}` : n.data?.challenge ? '/challenges' : null);
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('nt.title')} right={<button className="btn plain sm" onClick={markRead}>{t('nt.markRead')}</button>} />
      {loading ? <Loading /> : !items?.length ? <Empty icon="bell" text={t('nt.empty')} /> : (
        <List>
          {items.map((n) => (
            <Row
              key={n.id}
              onClick={target(n) ? () => nav(target(n)!) : undefined}
              icon={n.type.includes('eco') ? 'leaf' : n.type.includes('reward') || n.type.includes('redemption') ? 'gift' : n.type.includes('badge') || n.type.includes('challenge') ? 'trophy' : n.type === 'campaign' ? 'megaphone' : 'bell'}
              tile={n.read_at ? '#8e8e93' : 'var(--accent-bg)'}
              title={<span style={{ fontWeight: n.read_at ? 400 : 600 }}>{n.title}</span>}
              subtitle={`${n.body ? `${n.body} · ` : ''}${fmtRelative(n.created_at, lang)}`}
              chevron={Boolean(target(n))}
            />
          ))}
        </List>
      )}
    </main>
  );
}
