import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, assetUrl } from '../api.ts';
import { fmtDate, fmtNum, fmtWhen } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Chips, Empty, ErrorBox, List, Loading, NavBar, Row } from '../ui/ui.tsx';
import { QrCode } from '../components/Qr.tsx';

export function Events() {
  const { t, lang, me } = useApp();
  const [items, loading, error, reload] = useLoad<any[]>(() => api.get('/events'), [me?.id]);
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('ev.title')} />
      {loading ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : !items?.length ? <Empty icon="ticket" text={t('ev.empty')} /> : (
        <List>
          {items.map((e) => (
            <Row
              key={e.id}
              to={`/events/${e.id}`}
              icon={e.type === 'eco_run' ? 'leaf' : e.type === 'virtual' ? 'globe' : 'trophy'}
              tile={e.type === 'eco_run' ? 'var(--accent-bg)' : e.type === 'virtual' ? '#7d3cc9' : '#c93400'}
              title={e.title}
              subtitle={`${fmtWhen(e.start_at, lang, t)} · ${e.distances.map((d: any) => `${d.km} ${t('common.km')}`).join(' / ')}`}
              value={e.my_registration ? <span className="badge green">{t('ev.registered')}</span> : <span className="badge">{t(`ev.type.${e.type}`)}</span>}
            />
          ))}
        </List>
      )}
    </main>
  );
}

export function EventDetail() {
  const { id } = useParams();
  const { t, lang, me, toast, errorText } = useApp();
  const [e, loading, error, reload] = useLoad<any>(() => api.get(`/events/${id}`), [id, me?.id]);
  const [dist, setDist] = useState<string | null>(null);
  if (loading) return <main className="screen no-tab"><NavBar back /><Loading /></main>;
  if (error || !e) return <main className="screen no-tab"><NavBar back /><ErrorBox error={error} retry={reload} /></main>;
  const reg = e.my_registration;
  const selected = e.distances.find((d: any) => String(d.km) === dist);
  const count = (km: number) => Number(e.counts.find((c: any) => Number(c.distance_km) === Number(km))?.n ?? 0);
  const register = async () => {
    try {
      await api.post(`/events/${e.id}/register`, { distance_km: Number(dist) });
      reload();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  return (
    <main className="screen no-tab tight">
      <NavBar back="/events" />
      {e.cover_url && <img className="cover" src={assetUrl(e.cover_url)} alt="" />}
      <div className="col" style={{ gap: 6, padding: '0 4px' }}>
        <span className="badge" style={{ alignSelf: 'flex-start' }}>{t(`ev.type.${e.type}`)}</span>
        <h1 style={{ fontSize: 28, lineHeight: '34px', fontWeight: 700 }}>{e.title}</h1>
        <p className="muted">{fmtWhen(e.start_at, lang, t)}{e.location ? ` · ${e.location}` : ''}</p>
      </div>
      {e.description && <section className="card pad-sm"><p style={{ whiteSpace: 'pre-wrap' }}>{e.description}</p></section>}
      <List label={t('ev.distance')}>
        {e.distances.map((d: any) => (
          <Row
            key={d.km}
            icon="road"
            tile="#0066cc"
            title={`${d.km} ${t('common.km')}`}
            subtitle={d.limit ? `${count(d.km)} / ${d.limit}` : undefined}
            value={d.price > 0 ? t('ev.price', { p: fmtNum(d.price, lang) }) : t('ev.free')}
          />
        ))}
      </List>
      {e.registration_closes_at && <p className="footnote" style={{ padding: '0 4px' }}>{t('ev.closes', { d: fmtDate(e.registration_closes_at, lang) })}</p>}
      {reg?.status === 'confirmed' ? (
        <section className="card" style={{ alignItems: 'stretch' }}>
          <span className="headline center accent"><Icon name="checkCircle" size={18} /> {t('ev.registered')} · {reg.distance_km} {t('common.km')}</span>
          <h2 className="group-label center">{t('ev.ticket')}</h2>
          <QrCode value={`ECORUN:TICKET:${reg.ticket_code}`} label={t('ev.ticket')} />
          <p className="code-big">{reg.ticket_code}</p>
        </section>
      ) : !me ? (
        <Link className="btn block" to="/welcome">{t('common.signInToContinue')}</Link>
      ) : (
        <section className="col" style={{ gap: 10 }}>
          <Chips value={dist} onChange={setDist} options={e.distances.map((d: any) => ({ value: String(d.km), label: `${d.km} ${t('common.km')}` }))} wrap label={t('ev.distance')} />
          {selected?.price > 0 && !e.payments_configured && <p className="footnote">{t('ev.paymentsSoon')}</p>}
          <button className="btn block" disabled={!dist || (selected?.price > 0 && !e.payments_configured)} onClick={register}>{t('ev.register')}</button>
        </section>
      )}
    </main>
  );
}
