import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.ts';
import { approxPosition, parseGpx, pathLength, TASHKENT, type LatLng } from '../lib/geo.ts';
import { fromLocalInputs, toLocalInputs } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Chips, Loading, NavBar, PhotoInput, Segmented, Switch } from '../ui/ui.tsx';
import { MapView } from '../components/MapView.tsx';

const TYPES = ['casual', 'training', 'plogging', 'race_prep'] as const;

export function RunForm() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { t, me, toast, errorText } = useApp();
  const nav = useNavigate();
  const editing = Boolean(id);
  const [existing, loading] = useLoad<any>(() => (id ? api.get(`/runs/${id}`) : Promise.resolve(null)), [id]);
  const [meta] = useLoad<{ districts: string[] }>(() => api.get('/meta'));
  const tomorrow = toLocalInputs(new Date(Date.now() + 86400_000).toISOString());

  const [f, setF] = useState({
    title: '',
    type: (sp.get('spot') ? 'plogging' : 'casual') as (typeof TYPES)[number],
    date: tomorrow.date,
    time: '07:00',
    meeting: (sp.get('lat') ? { lat: Number(sp.get('lat')), lng: Number(sp.get('lng')) } : null) as LatLng | null,
    meeting_address: '',
    district: me?.district ?? '',
    route: [] as [number, number][],
    distance_km: '',
    pace_groups: [] as string[],
    level: 'all',
    capacity: '',
    women_only: false,
    requires_approval: false,
    recurring: false,
    club_id: sp.get('club') ?? '',
    description: '',
    cover_url: null as string | null,
    plogging_supplies: '',
    plogging_dropoff: '',
    dirty_spot_id: sp.get('spot'),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const [mode, setMode] = useState<'meeting' | 'route'>('meeting');
  const [center, setCenter] = useState<LatLng>(f.meeting ?? TASHKENT);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!f.meeting && !editing) approxPosition().then((p) => p && setCenter(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!existing) return;
    const lt = toLocalInputs(existing.start_at);
    setF((x) => ({
      ...x,
      title: existing.title,
      type: existing.type,
      date: lt.date,
      time: lt.time,
      meeting: { lat: existing.meeting_lat, lng: existing.meeting_lng },
      meeting_address: existing.meeting_address ?? '',
      district: existing.district ?? '',
      route: existing.route ?? [],
      distance_km: existing.distance_km ? String(existing.distance_km) : '',
      pace_groups: existing.pace_groups ?? [],
      level: existing.level ?? 'all',
      capacity: existing.capacity ? String(existing.capacity) : '',
      women_only: existing.women_only,
      requires_approval: existing.requires_approval,
      recurring: Boolean(existing.recurrence_rule),
      club_id: existing.club?.id ?? '',
      description: existing.description ?? '',
      cover_url: existing.cover_url,
      plogging_supplies: existing.plogging_supplies ?? '',
      plogging_dropoff: existing.plogging_dropoff ?? '',
    }));
    setCenter({ lat: existing.meeting_lat, lng: existing.meeting_lng });
  }, [existing]);

  const manageClubs = me?.clubs.filter((c) => c.role === 'owner' || c.role === 'co_organizer') ?? [];
  const canRecur = Boolean(f.club_id) || ['club_organizer', 'admin', 'moderator'].includes(me?.role ?? '');

  const onMap = (p: LatLng) => {
    if (mode === 'meeting') set('meeting', p);
    else {
      const route = [...f.route, [p.lat, p.lng] as [number, number]];
      setF((x) => ({ ...x, route, distance_km: route.length > 1 ? (pathLength(route) / 1000).toFixed(1) : x.distance_km }));
    }
  };

  const markers = useMemo(() => (f.meeting ? [{ id: 'm', lat: f.meeting.lat, lng: f.meeting.lng, kind: f.type, title: t('rf.meeting') }] : []), [f.meeting, f.type, t]);
  const lines = useMemo(() => (f.route.length > 1 ? [{ points: f.route }] : []), [f.route]);

  const submit = async () => {
    if (!f.meeting) return toast(t('rf.needMeeting'), 'error');
    setBusy(true);
    const body: any = {
      title: f.title.trim(),
      type: f.type,
      start_at: fromLocalInputs(f.date, f.time),
      meeting_lat: f.meeting.lat,
      meeting_lng: f.meeting.lng,
      meeting_address: f.meeting_address.trim() || null,
      district: f.district || null,
      route: f.route.length > 1 ? f.route : null,
      distance_km: f.distance_km ? Number(f.distance_km) : null,
      pace_groups: f.pace_groups,
      level: f.level,
      capacity: f.capacity ? Number(f.capacity) : null,
      women_only: f.women_only,
      requires_approval: f.requires_approval,
      description: f.description.trim() || null,
      cover_url: f.cover_url,
      plogging_supplies: f.type === 'plogging' ? f.plogging_supplies.trim() || null : null,
      plogging_dropoff: f.type === 'plogging' ? f.plogging_dropoff.trim() || null : null,
    };
    if (!editing) {
      body.club_id = f.club_id || null;
      body.recurrence_rule = f.recurring && canRecur ? 'WEEKLY' : null;
      body.dirty_spot_id = f.dirty_spot_id || null;
    }
    try {
      if (editing) {
        await api.patch(`/runs/${id}`, body);
        nav(`/runs/${id}`, { replace: true });
      } else {
        const r = await api.post('/runs', body);
        toast(t('rf.published'));
        nav(`/runs/${r.id}`, { replace: true });
      }
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (editing && loading) return <main className="screen no-tab"><NavBar back /><Loading /></main>;

  return (
    <main className="screen no-tab tight">
      <NavBar back title={editing ? t('rf.titleEdit') : t('rf.titleNew')} />
      <form className="col" style={{ gap: 18 }} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {f.dirty_spot_id && <p className="badge green" style={{ alignSelf: 'flex-start' }}>{t('rf.fromSpot')}</p>}
        <ul className="field-list">
          <li className="field stack">
            <label htmlFor="rf-title">{t('rf.name')}</label>
            <input id="rf-title" required minLength={3} maxLength={120} value={f.title} placeholder={t('rf.namePh')} onChange={(e) => set('title', e.target.value)} />
          </li>
        </ul>
        <section className="col" style={{ gap: 8 }}>
          <h2 className="group-label">{t('rf.type')}</h2>
          <Chips value={f.type} onChange={(v) => v && set('type', v)} options={TYPES.map((x) => ({ value: x, label: t(`type.${x}`) }))} wrap label={t('rf.type')} />
        </section>
        <ul className="field-list">
          <li className="field">
            <label htmlFor="rf-date">{t('rf.date')}</label>
            <input id="rf-date" type="date" required value={f.date} onChange={(e) => set('date', e.target.value)} />
          </li>
          <li className="field">
            <label htmlFor="rf-time">{t('rf.time')}</label>
            <input id="rf-time" type="time" required value={f.time} onChange={(e) => set('time', e.target.value)} />
          </li>
        </ul>

        <section className="col" style={{ gap: 8 }}>
          <h2 className="group-label">{t('rf.meeting')} · {t('rf.route')}</h2>
          <Segmented value={mode} onChange={setMode} options={[{ value: 'meeting', label: t('rf.setMeeting') }, { value: 'route', label: t('rf.routeDraw') }]} label={t('rf.meeting')} />
          <MapView className="map mid" center={center} markers={markers} lines={lines} onMapClick={onMap} label={t('rf.meetingHint')} />
          <p className="group-foot">{mode === 'meeting' ? t('rf.meetingHint') : t('rf.routeDrawing')}</p>
          {mode === 'route' && (
            <div className="row-flex wrap" style={{ gap: 8 }}>
              <button type="button" className="btn sm gray" disabled={!f.route.length} onClick={() => set('route', f.route.slice(0, -1))}>{t('rf.routeUndo')}</button>
              <button type="button" className="btn sm gray" disabled={!f.route.length} onClick={() => set('route', [])}>{t('rf.routeClear')}</button>
              <label className="btn sm tinted" style={{ position: 'relative' }}>
                <Icon name="upload" size={16} /> {t('rf.gpx')}
                <input
                  type="file"
                  accept=".gpx,application/gpx+xml,application/xml"
                  style={{ position: 'absolute', inset: 0, opacity: 0 }}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const pts = parseGpx(await file.text());
                    if (pts.length < 2) return toast(t('err.validation'), 'error');
                    setF((x) => ({ ...x, route: pts, distance_km: (pathLength(pts) / 1000).toFixed(1), meeting: x.meeting ?? { lat: pts[0][0], lng: pts[0][1] } }));
                    setCenter({ lat: pts[0][0], lng: pts[0][1] });
                  }}
                />
              </label>
            </div>
          )}
        </section>

        <ul className="field-list">
          <li className="field">
            <label htmlFor="rf-addr">{t('rf.address')}</label>
            <input id="rf-addr" maxLength={200} value={f.meeting_address} placeholder={t('rf.addressPh')} onChange={(e) => set('meeting_address', e.target.value)} />
          </li>
          <li className="field">
            <label htmlFor="rf-district">{t('ob.district')}</label>
            <select id="rf-district" value={f.district} onChange={(e) => set('district', e.target.value)}>
              <option value="">—</option>
              {meta?.districts.map((d) => <option key={d}>{d}</option>)}
            </select>
          </li>
          <li className="field">
            <label htmlFor="rf-dist">{t('rf.distance')}</label>
            <input id="rf-dist" type="number" inputMode="decimal" min={0.5} max={100} step={0.1} value={f.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
          </li>
          <li className="field">
            <label htmlFor="rf-cap">{t('rf.capacity')}</label>
            <input id="rf-cap" type="number" inputMode="numeric" min={2} max={1000} value={f.capacity} placeholder={t('rf.capacityPh')} onChange={(e) => set('capacity', e.target.value)} />
          </li>
        </ul>

        <section className="col" style={{ gap: 8 }}>
          <h2 className="group-label">{t('rf.paces')}</h2>
          <Chips value={f.pace_groups} multi onChange={(v) => set('pace_groups', v)} options={['4:30', '5:00', '5:30', '6:00', '6:30', '7:00', '7:30'].map((p) => ({ value: p, label: `${p}${t('common.perKm')}` }))} wrap label={t('rf.paces')} />
        </section>
        <section className="col" style={{ gap: 8 }}>
          <h2 className="group-label">{t('rf.level')}</h2>
          <Chips value={f.level} onChange={(v) => v && set('level', v)} options={(['all', 'beginner', 'intermediate', 'advanced'] as const).map((l) => ({ value: l, label: t(`level.${l}`) }))} wrap label={t('rf.level')} />
        </section>

        {f.type === 'plogging' && (
          <ul className="field-list">
            <li className="field stack">
              <label htmlFor="rf-sup">{t('rf.supplies')}</label>
              <input id="rf-sup" maxLength={300} value={f.plogging_supplies} onChange={(e) => set('plogging_supplies', e.target.value)} />
            </li>
            <li className="field stack">
              <label htmlFor="rf-drop">{t('rf.dropoff')}</label>
              <input id="rf-drop" maxLength={300} value={f.plogging_dropoff} onChange={(e) => set('plogging_dropoff', e.target.value)} />
            </li>
          </ul>
        )}

        <ul className="field-list">
          {!editing && manageClubs.length > 0 && (
            <li className="field">
              <label htmlFor="rf-club">{t('rf.club')}</label>
              <select id="rf-club" value={f.club_id} onChange={(e) => set('club_id', e.target.value)}>
                <option value="">{t('rf.noClub')}</option>
                {manageClubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </li>
          )}
          {!editing && canRecur && (
            <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('rf.recurring')}</span><Switch checked={f.recurring} onChange={(v) => set('recurring', v)} label={t('rf.recurring')} /></li>
          )}
          {me?.gender === 'female' && (
            <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('rf.womenOnly')}</span><Switch checked={f.women_only} onChange={(v) => set('women_only', v)} label={t('rf.womenOnly')} /></li>
          )}
          <li className="field"><span className="lbl grow" style={{ width: 'auto' }}>{t('rf.approval')}</span><Switch checked={f.requires_approval} onChange={(v) => set('requires_approval', v)} label={t('rf.approval')} /></li>
        </ul>

        <ul className="field-list">
          <li className="field stack">
            <label htmlFor="rf-desc">{t('rf.description')}</label>
            <textarea id="rf-desc" maxLength={3000} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </li>
        </ul>
        <PhotoInput value={f.cover_url} onChange={(u) => set('cover_url', u)} label={t('rf.cover')} />
        <button className="btn block" disabled={busy || f.title.trim().length < 3}>{editing ? t('rf.save') : t('rf.publish')}</button>
      </form>
    </main>
  );
}
