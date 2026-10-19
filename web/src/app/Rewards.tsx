import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Confirm, Empty, ErrorBox, LargeTitle, List, Loading, NavBar, Row, Segmented, Sheet } from '../ui/ui.tsx';
import { QrCode } from '../components/Qr.tsx';

const CAT: Record<string, { icon: string; bg: string }> = {
  cafe: { icon: 'coffee', bg: 'linear-gradient(135deg,#8a5a00,#c98a2b)' },
  sport: { icon: 'shoe', bg: 'linear-gradient(135deg,#0066cc,#3d8fe0)' },
  gym: { icon: 'dumbbell', bg: 'linear-gradient(135deg,#7d3cc9,#a46be0)' },
  eco: { icon: 'leaf', bg: 'linear-gradient(135deg,#1e7a38,#3aa55b)' },
  other: { icon: 'gift', bg: 'linear-gradient(135deg,#c93400,#e86a37)' },
};

function RewardArt({ r, tall }: { r: any; tall?: boolean }) {
  const c = CAT[r.category] ?? CAT.other;
  if (r.photo_url) return <img src={assetUrl(r.photo_url)} alt="" className="reward-art" style={{ objectFit: 'cover', width: '100%', aspectRatio: tall ? '16 / 9' : undefined }} />;
  return (
    <div className="reward-art" style={{ background: c.bg, color: '#fff', aspectRatio: tall ? '16 / 9' : undefined }} aria-hidden="true">
      <Icon name={c.icon} size={tall ? 64 : 40} stroke={1.6} />
    </div>
  );
}

export function Rewards() {
  const { t, lang, me } = useApp();
  const [cat, setCat] = useState<string>('all');
  const [items, loading, error, reload] = useLoad<any[]>(() => api.get(`/rewards${cat === 'all' ? '' : `?category=${cat}`}`), [cat]);
  const [meta] = useLoad<any>(() => api.get('/meta'));
  const pts = meta?.points;
  return (
    <main className="screen">
      <LargeTitle title={t('rw.title')} right={me && <Link className="icon-btn" to="/rewards/codes" aria-label={t('rw.myCodes')}><Icon name="qr" size={22} /></Link>} />
      {me ? (
        <section className="card" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="col" style={{ gap: 2 }}>
            <span className="sub">{t('rw.balance')}</span>
            <span className="big-num accent">{fmtNum(me.points.balance, lang)}</span>
            {me.points.pending > 0 && <span className="footnote">{t('rw.pending', { n: me.points.pending })}</span>}
          </div>
          <Link className="btn sm tinted" to="/profile/points">{t('pr.history')}</Link>
        </section>
      ) : (
        <Link className="btn block" to="/welcome">{t('common.signInToContinue')}</Link>
      )}
      <Segmented value={cat} onChange={setCat} options={['all', 'cafe', 'sport', 'gym', 'eco'].map((c) => ({ value: c, label: t(`rw.cat.${c}`) }))} label={t('rw.title')} />
      {loading && !items ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : !items?.length ? <Empty icon="gift" text={t('rw.empty')} /> : (
        <div className="reward-grid">
          {items.map((r) => (
            <Link key={r.id} to={`/rewards/${r.id}`} className="reward-card">
              <RewardArt r={r} />
              <div className="col" style={{ padding: '12px 14px 14px', gap: 4 }}>
                <span className="footnote">{r.partner.name}</span>
                <span className="headline">{r.title}</span>
                <div className="row-flex" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="badge green"><Icon name="leaf" size={12} /> {r.points_price}</span>
                  <span className="caption">{r.available > 0 ? t('rw.left', { n: r.available }) : t('rw.soldOut')}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      {pts && (
        <List label={t('rw.howToEarn')}>
          <Row icon="runner" title={t('reason.run_km')} value={`+${pts.run_km}${t('common.perKm')}`} />
          <Row icon="bolt" tile="#0066cc" title={t('reason.commute_km')} value={`+${pts.commute_km}${t('common.perKm')}`} />
          <Row icon="people" tile="#0066cc" title={t('reason.group_attendance')} value={`+${pts.group_attendance}`} />
          <Row icon="bag" tile="#8a5a00" title={t('reason.plogging_bag')} value={`+${pts.plogging_bag}`} />
          <Row icon="pin" tile="#d70015" title={t('reason.dirty_spot')} value={`+${pts.dirty_spot}`} />
          <Row icon="flag" tile="#c93400" title={t('reason.organize_run')} value={`+${pts.organize_run}`} />
          <Row icon="userPlus" tile="#7d3cc9" title={t('reason.invite')} value={`+${pts.invite}`} />
        </List>
      )}
    </main>
  );
}

export function CodeView({ code, title, expires }: { code: string; title: string; expires?: string }) {
  const { t, lang } = useApp();
  return (
    <div className="col" style={{ gap: 12, alignItems: 'stretch' }}>
      <p className="center headline">{title}</p>
      <QrCode value={`ECORUN:REWARD:${code}`} label={t('rw.codeTitle')} />
      <p className="code-big">{code}</p>
      <p className="footnote center">{t('rw.codeTitle')}{expires ? ` · ${t('rw.codeExpires', { d: fmtDate(expires, lang) })}` : ''}</p>
    </div>
  );
}

export function RewardDetail() {
  const { id } = useParams();
  const { t, lang, me, refreshMe, toast, errorText } = useApp();
  const [r, loading, error, reload] = useLoad<any>(() => api.get(`/rewards/${id}`), [id]);
  const [confirm, setConfirm] = useState(false);
  const [code, setCode] = useState<any>(null);
  if (loading) return <main className="screen no-tab"><NavBar back /><Loading /></main>;
  if (error || !r) return <main className="screen no-tab"><NavBar back /><ErrorBox error={error} retry={reload} /></main>;
  const lack = me ? r.points_price - me.points.balance : 0;
  const claim = async () => {
    try {
      const res = await api.post(`/rewards/${r.id}/claim`);
      setCode(res);
      refreshMe();
      reload();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <main className="screen no-tab tight">
      <NavBar back="/rewards" />
      <div style={{ borderRadius: 22, overflow: 'hidden' }}><RewardArt r={r} tall /></div>
      <div className="col" style={{ gap: 4, padding: '0 4px' }}>
        <span className="sub">{r.partner.name}</span>
        <h1 style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700 }}>{r.title}</h1>
        {r.description && <p className="muted">{r.description}</p>}
      </div>
      <List>
        <Row icon="leaf" title={t('pt.price')} value={`${r.points_price} ${t('common.pts')}`} />
        <Row icon="bag" tile="#c93400" title={t('pt.stock')} value={r.available > 0 ? t('rw.left', { n: r.available }) : t('rw.soldOut')} />
        {r.valid_until && <Row icon="calendar" tile="#0066cc" title={t('pt.validUntil')} value={fmtDate(r.valid_until, lang)} />}
      </List>
      {r.branches?.length > 0 && <List label={t('rw.branches')}>{r.branches.map((b: string) => <Row key={b} icon="store" tile="#7d3cc9" title={b} />)}</List>}
      {r.terms && <section className="card pad-sm"><h2 className="group-label" style={{ padding: 0 }}>{t('rw.terms')}</h2><p>{r.terms}</p></section>}
      {!me ? (
        <Link className="btn block" to="/welcome">{t('common.signInToContinue')}</Link>
      ) : r.available <= 0 ? (
        <button className="btn block" disabled>{t('rw.soldOut')}</button>
      ) : lack > 0 ? (
        <button className="btn block" disabled>{t('rw.notEnough', { n: lack })}</button>
      ) : (
        <button className="btn block" onClick={() => setConfirm(true)}>{t('rw.claim', { n: r.points_price })}</button>
      )}
      <Confirm open={confirm} onClose={() => setConfirm(false)} text={t('rw.confirmClaim', { n: r.points_price, title: r.title })} onConfirm={claim} />
      <Sheet open={Boolean(code)} onClose={() => setCode(null)} title={t('rw.myCodes')}>
        {code && <CodeView code={code.code} title={code.title} expires={code.expires_at} />}
        <Link className="btn block gray" to="/rewards/codes">{t('rw.myCodes')}</Link>
      </Sheet>
    </main>
  );
}

export function MyCodes() {
  const { t, lang } = useApp();
  const [items, loading] = useLoad<any[]>(() => api.get('/me/redemptions'));
  const [sel, setSel] = useState<any>(null);
  return (
    <main className="screen no-tab tight">
      <NavBar back="/rewards" title={t('rw.myCodes')} />
      {loading ? <Loading /> : !items?.length ? <Empty icon="qr" text={t('rw.noCodes')} action={<Link className="btn sm" to="/rewards">{t('rw.title')}</Link>} /> : (
        <List>
          {items.map((r) => (
            <Row
              key={r.id}
              onClick={r.status === 'issued' ? () => setSel(r) : undefined}
              icon="qr"
              tile={r.status === 'issued' ? 'var(--accent-bg)' : '#8e8e93'}
              title={r.reward.title}
              subtitle={`${r.reward.partner} · ${r.status === 'issued' ? t('rw.codeExpires', { d: fmtDate(r.expires_at, lang) }) : r.status === 'redeemed' ? t('rw.codeUsed', { d: fmtDateTime(r.redeemed_at, lang) }) : t('rw.codeExpired')}`}
              value={r.status === 'issued' ? <span className="code-big" style={{ fontSize: 15, letterSpacing: '0.1em' }}>{r.code}</span> : null}
              chevron={r.status === 'issued'}
            />
          ))}
        </List>
      )}
      <Sheet open={Boolean(sel)} onClose={() => setSel(null)} title={t('rw.myCodes')}>
        {sel && <CodeView code={sel.code} title={sel.reward.title} expires={sel.expires_at} />}
      </Sheet>
    </main>
  );
}
