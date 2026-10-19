import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { LANGS } from '../i18n/index.ts';
import { fmtPace } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Avatar, Chips, Confirm, Empty, List, Loading, NavBar, PhotoInput, Row, Segmented, Sheet, Switch } from '../ui/ui.tsx';
import { QrCode } from '../components/Qr.tsx';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

async function enablePush(vapid: string) {
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
  await navigator.serviceWorker.ready;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('denied');
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapid) });
  const json = sub.toJSON();
  await api.post('/me/push', { endpoint: json.endpoint, keys: json.keys });
}

export function Settings() {
  const { t, lang, setLang, theme, setTheme, me, refreshMe, logout, toast, errorText } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [meta] = useLoad<any>(() => api.get('/meta'));
  const [integrations] = useLoad<any>(() => api.get('/integrations'));
  const [blocked, , , reloadBlocked] = useLoad<any[]>(() => api.get('/me/blocks'));
  const [del, setDel] = useState(false);
  const [totp, setTotp] = useState<{ secret: string; otpauth: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && Boolean(meta?.vapidPublicKey);
  const [pushOn, setPushOn] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');

  useEffect(() => {
    const s = sp.get('strava');
    if (s) toast(s === 'ok' ? t('st.stravaConnect') + ' ✓' : t('err.generic'), s === 'ok' ? 'ok' : 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!me) return null;
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch('/me', body);
      await refreshMe();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const run = async (fn: () => Promise<any>) => {
    try {
      return await fn();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <main className="screen no-tab tight">
      <NavBar back="/profile" title={t('st.title')} />
      <section className="col" style={{ gap: 8 }}>
        <h2 className="group-label">{t('st.language')}</h2>
        <Segmented value={lang} onChange={setLang} options={LANGS.map((l) => ({ value: l.code, label: l.label }))} label={t('st.language')} />
      </section>
      <section className="col" style={{ gap: 8 }}>
        <h2 className="group-label">{t('st.theme')}</h2>
        <Segmented value={theme} onChange={setTheme} options={(['system', 'light', 'dark'] as const).map((x) => ({ value: x, label: t(`st.theme.${x}`) }))} label={t('st.theme')} />
      </section>

      <List label={t('st.profile')}>
        <Row to="/profile/edit" leading={<Avatar src={me.photo_url} name={me.name} size={32} />} title={me.name} subtitle={me.phone ?? me.telegram_username ?? ''} />
      </List>

      <section className="col" style={{ gap: 6 }}>
        <h2 className="group-label">{t('st.privacy')}</h2>
        <ul className="field-list">
          <li className="field">
            <label htmlFor="st-vis">{t('st.visibility')}</label>
            <select id="st-vis" value={me.visibility} onChange={(e) => patch({ visibility: e.target.value })}>
              {(['all', 'followers', 'nobody'] as const).map((v) => <option key={v} value={v}>{t(`st.vis.${v}`)}</option>)}
            </select>
          </li>
          <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('st.hideLocation')}</span><Switch checked={me.hide_location} onChange={(v) => patch({ hide_location: v })} label={t('st.hideLocation')} /></li>
        </ul>
      </section>

      <section className="col" style={{ gap: 6 }}>
        <h2 className="group-label">{t('st.notifications')}</h2>
        <ul className="field-list">
          <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('st.nearby')}</span><Switch checked={me.notify_nearby} onChange={(v) => patch({ notify_nearby: v })} label={t('st.nearby')} /></li>
          <li className="field">
            <label htmlFor="st-rad">{t('st.radius')}</label>
            <select id="st-rad" value={me.notify_radius_km} onChange={(e) => patch({ notify_radius_km: Number(e.target.value) })}>
              {[2, 5, 10, 20].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </li>
          <li className="field">
            <span className="lbl grow" style={{ width: 'auto' }}>{t('st.push')}</span>
            {!pushSupported ? <span className="row-value">{t('st.pushUnsupported')}</span> : pushOn ? <span className="row-value accent">{t('st.pushOn')}</span> : (
              <button className="btn sm tinted" onClick={() => run(async () => { await enablePush(meta.vapidPublicKey); setPushOn(true); })}>{t('st.pushEnable')}</button>
            )}
          </li>
        </ul>
      </section>

      <List label={t('st.connections')}>
        <Row
          icon="telegram"
          tile="#2AABEE"
          title={t('st.telegram')}
          subtitle={me.telegram_username ? `@${me.telegram_username}` : undefined}
          trailing={me.telegram_linked ? (
            <button className="btn sm gray" onClick={() => run(async () => { await api.post('/auth/telegram/unlink'); refreshMe(); })}>{t('st.telegramUnlink')}</button>
          ) : (
            <button className="btn sm tinted" onClick={() => run(async () => { const r = await api.post('/auth/telegram/link'); window.open(r.url, '_blank', 'noopener'); })}>{t('st.telegramLink')}</button>
          )}
        />
        <Row
          icon="bolt"
          tile="#fc4c02"
          title={t('st.strava')}
          subtitle={!integrations?.strava ? t('err.strava_not_configured') : undefined}
          trailing={me.strava_verified ? (
            <span className="row-flex" style={{ gap: 6 }}>
              <button className="btn sm tinted" onClick={() => run(async () => { const r = await api.post('/integrations/strava/sync'); toast(t('st.synced', { n: r.imported })); })}>{t('st.stravaSync')}</button>
              <button className="btn sm gray" onClick={() => run(async () => { await api.post('/integrations/strava/unlink'); refreshMe(); })}>{t('st.stravaUnlink')}</button>
            </span>
          ) : integrations?.strava ? (
            <button className="btn sm tinted" onClick={() => run(async () => { const r = await api.get('/integrations/strava/url'); window.location.href = r.url; })}>{t('st.stravaConnect')}</button>
          ) : null}
        />
        <Row icon="heart" tile="#ff2d55" title={t('st.health')} value={t('st.healthNote')} />
      </List>

      {['admin', 'moderator', 'partner'].includes(me.role) && (
        <List label={t('st.security')}>
          <Row
            icon="lock"
            tile="#000"
            title={t('st.totp')}
            trailing={me.totp_enabled ? <span className="row-value accent">{t('st.totpOn')}</span> : <button className="btn sm tinted" onClick={() => run(async () => setTotp(await api.post('/me/totp/setup')))}>{t('st.totpSetup')}</button>}
          />
        </List>
      )}

      {blocked && blocked.length > 0 && (
        <List label={t('st.blocked')}>
          {blocked.map((u) => (
            <Row key={u.id} leading={<Avatar src={u.photo_url} name={u.name} size={30} />} title={u.name} trailing={<button className="btn sm gray" onClick={() => run(async () => { await api.del(`/users/${u.id}/block`); reloadBlocked(); })}>{t('us.unblock')}</button>} />
          ))}
        </List>
      )}

      <List label={t('st.data')}>
        <Row icon="download" tile="#0066cc" title={t('st.export')} onClick={() => run(() => api.download('/me/export', 'ecorun-data.json'))} chevron />
        <Row icon="trash" tile="#d70015" title={t('st.delete')} danger onClick={() => setDel(true)} chevron />
      </List>
      <List>
        <Row to="/page/faq" icon="info" tile="#8e8e93" title={t('st.faq')} />
        <Row to="/page/terms" icon="file" tile="#8e8e93" title={t('st.terms')} />
        <Row to="/page/privacy" icon="shield" tile="#8e8e93" title={t('st.privacyPolicy')} />
      </List>
      <button className="btn block danger" onClick={async () => { await logout(); nav('/welcome', { replace: true }); }}>{t('st.logout')}</button>
      <p className="caption center">{t('st.version')} 0.1.0 · {fmtPace(me.pace_sec_per_km)}{t('common.perKm')}</p>

      <Confirm open={del} onClose={() => setDel(false)} danger text={t('st.deleteConfirm')} confirmLabel={t('st.delete')} onConfirm={() => run(async () => { await api.del('/me'); await logout(); nav('/welcome', { replace: true }); })} />
      <Sheet open={Boolean(totp)} onClose={() => setTotp(null)} title={t('st.totp')}>
        {totp && (
          <>
            <p className="footnote">{t('st.totpScan')}</p>
            <QrCode value={totp.otpauth} label={t('st.totp')} />
            <p className="code-big" style={{ fontSize: 16, wordBreak: 'break-all' }}>{totp.secret}</p>
            <form className="col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post('/me/totp/enable', { code: totpCode }); setTotp(null); refreshMe(); }); }}>
              <label className="sr-only" htmlFor="totp-code">{t('login.totpTitle')}</label>
              <input id="totp-code" className="input-big otp" inputMode="numeric" maxLength={6} value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))} />
              <button className="btn block" disabled={totpCode.length !== 6}>{t('common.confirm')}</button>
            </form>
          </>
        )}
      </Sheet>
    </main>
  );
}

export function EditProfile() {
  const { t, me, refreshMe, toast, errorText } = useApp();
  const nav = useNavigate();
  const [meta] = useLoad<any>(() => api.get('/meta'));
  const [f, setF] = useState(() => ({
    name: me?.name ?? '',
    photo_url: me?.photo_url ?? null,
    gender: me?.gender ?? 'other',
    age_range: me?.age_range ?? null,
    district: me?.district ?? '',
    level: me?.level ?? 'beginner',
    pace_sec_per_km: me?.pace_sec_per_km ?? 390,
    preferred_distances: (me?.preferred_distances ?? []).map(String),
    preferred_time: me?.preferred_time ?? 'morning',
  }));
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    try {
      await api.patch('/me', { ...f, name: f.name.trim(), district: f.district || null, preferred_distances: f.preferred_distances.map(Number) });
      await refreshMe();
      nav(-1);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <main className="screen no-tab tight">
      <NavBar back title={t('pr.edit')} right={<button className="btn plain" onClick={save} disabled={!f.name.trim()}>{t('common.save')}</button>} />
      <div style={{ width: 140, alignSelf: 'center' }}><PhotoInput value={f.photo_url} onChange={(u) => set('photo_url', u)} label={t('ob.photo')} /></div>
      <ul className="field-list">
        <li className="field"><label htmlFor="ep-name">{t('ob.name')}</label><input id="ep-name" maxLength={60} value={f.name} onChange={(e) => set('name', e.target.value)} /></li>
        <li className="field">
          <label htmlFor="ep-gender">{t('ob.gender')}</label>
          <select id="ep-gender" value={f.gender} onChange={(e) => set('gender', e.target.value)}>
            {(['female', 'male', 'other'] as const).map((g) => <option key={g} value={g}>{t(`ob.gender.${g}`)}</option>)}
          </select>
        </li>
        <li className="field">
          <label htmlFor="ep-age">{t('ob.age')}</label>
          <select id="ep-age" value={f.age_range ?? ''} onChange={(e) => set('age_range', e.target.value || null)}>
            <option value="">—</option>
            {['18-24', '25-34', '35-44', '45-54', '55+'].map((a) => <option key={a}>{a}</option>)}
          </select>
        </li>
        <li className="field">
          <label htmlFor="ep-district">{t('ob.district')}</label>
          <select id="ep-district" value={f.district} onChange={(e) => set('district', e.target.value)}>
            <option value="">—</option>
            {meta?.districts.map((d: string) => <option key={d}>{d}</option>)}
          </select>
        </li>
        <li className="field">
          <label htmlFor="ep-level">{t('ob.level')}</label>
          <select id="ep-level" value={f.level} onChange={(e) => set('level', e.target.value)}>
            {(['beginner', 'intermediate', 'advanced'] as const).map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
          </select>
        </li>
        <li className="field">
          <label htmlFor="ep-pace">{t('ob.pace')}</label>
          <input id="ep-pace" type="range" min={210} max={600} step={15} value={f.pace_sec_per_km} onChange={(e) => set('pace_sec_per_km', Number(e.target.value))} aria-valuetext={fmtPace(f.pace_sec_per_km)} />
          <span style={{ minWidth: 64, textAlign: 'right' }}>{fmtPace(f.pace_sec_per_km)}</span>
        </li>
        <li className="field">
          <label htmlFor="ep-time">{t('ob.time')}</label>
          <select id="ep-time" value={f.preferred_time} onChange={(e) => set('preferred_time', e.target.value)}>
            {(['morning', 'day', 'evening'] as const).map((x) => <option key={x} value={x}>{t(`time.${x}`)}</option>)}
          </select>
        </li>
      </ul>
      <section className="col" style={{ gap: 8 }}>
        <h2 className="group-label">{t('ob.distances')}</h2>
        <Chips value={f.preferred_distances} multi onChange={(v) => set('preferred_distances', v)} options={['3', '5', '10', '21', '42'].map((d) => ({ value: d, label: `${d} ${t('common.km')}` }))} wrap label={t('ob.distances')} />
      </section>
      <p className="group-foot">{t('ob.genderWhy')}</p>
    </main>
  );
}

export function ContentPage() {
  const { kind } = useParams();
  const { t, lang } = useApp();
  const [items, loading] = useLoad<any[]>(() => api.get(`/content?kind=${kind}&lang=${lang}`), [kind, lang]);
  const title = kind === 'faq' ? t('st.faq') : kind === 'terms' ? t('st.terms') : t('st.privacyPolicy');
  return (
    <main className="screen no-tab tight">
      <NavBar back title={title} />
      {loading ? <Loading /> : !items?.length ? <Empty text="—" /> : kind === 'faq' ? (
        items.map((i) => (
          <details key={i.id} className="card pad-sm">
            <summary className="headline" style={{ cursor: 'pointer', minHeight: 32 }}>{i.title}</summary>
            <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{i.body}</p>
          </details>
        ))
      ) : (
        items.map((i) => (
          <article key={i.id} className="card">
            <h2 className="title3">{i.title}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{i.body}</p>
          </article>
        ))
      )}
    </main>
  );
}
