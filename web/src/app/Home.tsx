import { Link } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { fmtDate, fmtNum, fmtRelative, fmtWhen } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Avatar, LargeTitle, List, Progress } from '../ui/ui.tsx';
import { RunRow, type RunLite } from '../components/RunCard.tsx';

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Tashkent', hour: '2-digit', hour12: false }));
  return h < 12 ? 'home.greeting.morning' : h < 18 ? 'home.greeting.day' : 'home.greeting.evening';
}

export function CityCounter() {
  const { t, lang } = useApp();
  const [city] = useLoad<any>(() => api.get('/city'));
  return (
    <section className="card" aria-labelledby="city-title">
      <h2 id="city-title" className="sub headline">{t('home.city')}</h2>
      <div className="grid3">
        <div className="stat"><span className="v accent">{fmtNum(city?.km ?? 0, lang)}</span><span className="l">{t('home.cityKm')}</span></div>
        <div className="stat"><span className="v">{fmtNum(city?.bags ?? 0, lang)}</span><span className="l">{t('home.cityBags')}</span></div>
        <div className="stat"><span className="v">{fmtNum(city?.participants ?? 0, lang)}</span><span className="l">{t('home.cityPeople')}</span></div>
      </div>
    </section>
  );
}

export function ImpactHero({ impact }: { impact: any }) {
  const { t, lang } = useApp();
  return (
    <section className="hero-impact" aria-labelledby="impact-title">
      <div className="row-flex" style={{ justifyContent: 'space-between' }}>
        <h2 id="impact-title" className="headline">{t('home.impact')}</h2>
        <Icon name="leaf" size={22} />
      </div>
      <div className="grid2" style={{ rowGap: 14 }}>
        <div className="stat"><span className="v">{fmtNum(impact?.km ?? 0, lang)}</span><span className="l">{t('impact.km')}</span></div>
        <div className="stat"><span className="v">{fmtNum(impact?.kgWaste ?? 0, lang)}</span><span className="l">{t('impact.kg')}</span></div>
        <div className="stat"><span className="v">{fmtNum(impact?.co2Kg ?? 0, lang)}</span><span className="l">{t('impact.co2')}</span></div>
        <div className="stat"><span className="v">{fmtNum(impact?.trees ?? 0, lang)}</span><span className="l">{t('impact.trees')}</span></div>
      </div>
    </section>
  );
}

export function ChallengeCard({ c, onJoin }: { c: any; onJoin?: () => void }) {
  const { t, lang } = useApp();
  return (
    <div className="card pad-sm" style={{ width: 260, gap: 10 }}>
      <div className="row-flex" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span className="tile md" style={{ background: c.completed_at ? '#34c759' : 'var(--orange)' }}><Icon name="trophy" size={20} /></span>
        <span className="badge green">{t('ch.reward', { n: c.reward_points })}</span>
      </div>
      <div className="col" style={{ gap: 2 }}>
        <span className="headline">{c.title}</span>
        <span className="footnote">{c.sponsor_name ? t('ch.sponsor', { name: c.sponsor_name }) : t('ch.ends', { d: fmtDate(c.ends_at, lang, { day: 'numeric', month: 'short' }) })}</span>
      </div>
      {c.joined ? (
        <>
          <Progress value={Number(c.progress ?? 0)} max={Number(c.target)} label={c.title} />
          <span className="footnote">
            {c.completed_at ? t('ch.completed') : t('ch.progress', { p: c.progress ?? 0, t: `${c.target} ${t(`ch.metric.${c.metric}`)}` })}
          </span>
        </>
      ) : (
        onJoin && <button className="btn sm tinted" onClick={onJoin}>{t('ch.join')}</button>
      )}
    </div>
  );
}

export function Home() {
  const { t, lang, me, unread, toast, errorText } = useApp();
  const [mine] = useLoad<any>(() => (me ? api.get('/runs/mine') : Promise.resolve(null)), [me?.id]);
  const [stats] = useLoad<any>(() => (me ? api.get('/me/stats') : Promise.resolve(null)), [me?.id]);
  const [challenges, , , reloadCh] = useLoad<any[]>(() => api.get('/challenges'), [me?.id]);
  const [featured] = useLoad<RunLite[]>(() => api.get('/runs?featured=true&limit=5'), [me?.id]);
  const [banners] = useLoad<any[]>(() => api.get(`/content?kind=banner&lang=${lang}`), [lang]);
  const [feed] = useLoad<any[]>(() => (me ? api.get('/feed') : Promise.resolve([])), [me?.id]);
  const next = mine?.upcoming?.[0] as (RunLite & { is_organizer: boolean }) | undefined;

  const join = async (id: string) => {
    if (!me) return;
    try {
      await api.post(`/challenges/${id}/join`);
      reloadCh();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <main className="screen">
      <LargeTitle
        eyebrow={me ? t(greeting()) : 'EcoRun'}
        title={me?.name?.split(' ')[0] ?? t('tab.home')}
        right={
          me ? (
            <>
              <Link className="icon-btn" to="/notifications" aria-label={t('nt.title')}>
                <Icon name="bell" size={22} />
                {unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
              </Link>
              <Link to="/profile" aria-label={t('tab.profile')}><Avatar src={me.photo_url} name={me.name} size={44} /></Link>
            </>
          ) : (
            <Link className="btn sm pill" to="/welcome">{t('common.signIn')}</Link>
          )
        }
      />

      {!me && (
        <section className="card">
          <h2 className="title3">{t('home.guestTitle')}</h2>
          <p className="muted">{t('home.guestBody')}</p>
          <Link className="btn" to="/login">{t('welcome.phone')}</Link>
        </section>
      )}

      <CityCounter />

      {me && (
        <section className="section" aria-labelledby="next-title">
          <h2 id="next-title" className="title2" style={{ padding: '0 4px' }}>{t('home.next')}</h2>
          {next ? (
            <div className="card pad-sm">
              <div className="row-flex">
                <span className="tile lg" style={{ background: next.my_status === 'checked_in' ? '#34c759' : 'var(--orange)' }}><Icon name="runner" size={24} /></span>
                <div className="grow col" style={{ gap: 0 }}>
                  <span className="headline ellipsis">{next.title}</span>
                  <span className="sub">{fmtWhen(next.start_at, lang, t)} · {fmtRelative(next.start_at, lang)}</span>
                </div>
              </div>
              <div className="inset">
                <div className="kv"><span>{t('run.meeting')}</span><span className="ellipsis" style={{ maxWidth: '60%' }}>{next.meeting_address ?? '—'}</span></div>
                <div className="kv"><span>{t('run.participants')}</span><span>{next.participants_count}{next.capacity ? ` / ${next.capacity}` : ''}</span></div>
              </div>
              <div className="btn-row">
                <Link className="btn tinted" to={`/runs/${next.id}/chat`}><Icon name="chat" size={18} /> {t('run.chat')}</Link>
                <Link className="btn gray" to={`/runs/${next.id}`}>{t('common.view')}</Link>
              </div>
            </div>
          ) : (
            <div className="card pad-sm" style={{ alignItems: 'flex-start' }}>
              <p className="muted">{t('home.noNext')}</p>
              <Link className="btn sm" to="/runs">{t('home.findRun')}</Link>
            </div>
          )}
        </section>
      )}

      <div className="grid2" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {[
          { to: '/runs/new', icon: 'plus', label: t('home.quick.create'), bg: 'var(--accent-bg)' },
          { to: '/record', icon: 'play', label: t('home.quick.record'), bg: 'var(--orange)' },
          { to: '/eco/log', icon: 'leaf', label: t('home.quick.plog'), bg: '#8a5a00' },
          { to: '/eco/spots', icon: 'pin', label: t('home.quick.spot'), bg: '#d70015' },
        ].map((q) => (
          <Link key={q.to} to={q.to} className="card pad-sm" style={{ alignItems: 'center', gap: 8, padding: '14px 6px', textDecoration: 'none', color: 'var(--label)' }}>
            <span className="tile md" style={{ background: q.bg }}><Icon name={q.icon} size={20} fill={q.icon === 'play'} /></span>
            <span className="caption center" style={{ color: 'var(--label)', fontWeight: 600 }}>{q.label}</span>
          </Link>
        ))}
      </div>

      {me && stats && (
        <Link to="/profile" style={{ textDecoration: 'none' }} aria-label={t('home.impact')}>
          <ImpactHero impact={stats.impact} />
        </Link>
      )}

      {banners?.map((b) => (
        <Link key={b.id} to={b.link || '/runs?type=plogging'} className="card" style={{ background: 'var(--accent-tint)', textDecoration: 'none', color: 'var(--label)' }}>
          {b.image_url && <img src={assetUrl(b.image_url)} alt="" className="cover" />}
          <span className="title3 accent">{b.title}</span>
          <span className="muted">{b.body}</span>
        </Link>
      ))}

      {challenges && challenges.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="title2">{t('home.challenges')}</h2>
            <Link to="/challenges">{t('common.seeAll')}</Link>
          </div>
          <div className="hscroll">
            {challenges.map((c) => (
              <ChallengeCard key={c.id} c={c} onJoin={me ? () => join(c.id) : undefined} />
            ))}
          </div>
        </section>
      )}

      {featured && featured.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="title2">{t('home.featured')}</h2>
            <Link to="/runs">{t('common.seeAll')}</Link>
          </div>
          <List round>{featured.map((r) => <RunRow key={r.id} run={r} />)}</List>
        </section>
      )}

      {me && (
        <section className="section">
          <div className="section-head">
            <h2 className="title2">{t('home.feed')}</h2>
            <Link to="/buddies">{t('home.buddies')}</Link>
          </div>
          {feed && feed.length ? (
            <List round>
              {feed.slice(0, 12).map((f) => (
                <FeedRow key={`${f.kind}-${f.id}-${f.actor.id}`} f={f} />
              ))}
            </List>
          ) : (
            <div className="card pad-sm"><p className="muted">{t('home.feedEmpty')}</p></div>
          )}
        </section>
      )}
    </main>
  );
}

function FeedRow({ f }: { f: any }) {
  const { t, lang } = useApp();
  const what =
    f.kind === 'activity' ? t('feed.activity', { km: (f.data.distance_m / 1000).toFixed(1) })
    : f.kind === 'eco' ? t('feed.eco', { n: f.data.bags })
    : f.kind === 'run' ? `${t('feed.run')}: ${f.data.title}`
    : `${t('feed.badge')}: ${f.data.title?.[lang] ?? f.data.title?.en ?? ''}`;
  const to = f.kind === 'activity' ? `/activities/${f.id}` : f.kind === 'run' ? `/runs/${f.id}` : `/users/${f.actor.id}`;
  return (
    <Link className="row" to={to}>
      <Avatar src={f.actor.photo_url} name={f.actor.name} size={36} />
      <span className="row-inner">
        <span className="row-text">
          <span><b>{f.actor.name}</b> {what}</span>
          <span className="footnote">{fmtRelative(f.at, lang)}</span>
        </span>
        <Icon name="chevR" size={14} stroke={2.4} className="chev" />
      </span>
    </Link>
  );
}
