import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { TASHKENT, type LatLng } from '../lib/geo.ts';

export type MapMarker = { id: string; lat: number; lng: number; kind?: string; title?: string; onClick?: () => void };
export type MapLine = { points: [number, number][]; color?: string; dashed?: boolean };

type Props = {
  center?: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  lines?: MapLine[];
  me?: LatLng | null;
  onMapClick?: (p: LatLng) => void;
  fit?: boolean;
  className?: string;
  label: string;
  interactive?: boolean;
};

export function MapView({ center, zoom = 13, markers = [], lines = [], me, onMapClick, fit, className = 'map mid', label, interactive = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, {
      zoomControl: false,
      attributionControl: true,
      dragging: interactive,
      scrollWheelZoom: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
    }).setView([center?.lat ?? TASHKENT.lat, center?.lng ?? TASHKENT.lng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(m);
    if (interactive) L.control.zoom({ position: 'bottomright' }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => clickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const bounds: L.LatLngExpression[] = [];
    for (const ln of lines) {
      if (ln.points.length < 2) continue;
      L.polyline(ln.points, { color: ln.color ?? '#1e7a38', weight: 5, opacity: 0.85, dashArray: ln.dashed ? '6 8' : undefined }).addTo(g);
      bounds.push(...ln.points);
    }
    for (const mk of markers) {
      const icon = L.divIcon({ className: '', html: `<div class="pin ${mk.kind ?? ''}"></div>`, iconSize: [30, 30], iconAnchor: mk.kind?.startsWith('spot') ? [11, 11] : [15, 30] });
      const marker = L.marker([mk.lat, mk.lng], { icon, title: mk.title, keyboard: Boolean(mk.onClick), alt: mk.title }).addTo(g);
      if (mk.onClick) marker.on('click', mk.onClick);
      if (mk.title) marker.bindTooltip(mk.title, { direction: 'top', offset: [0, -28] });
      bounds.push([mk.lat, mk.lng]);
    }
    if (me) {
      L.marker([me.lat, me.lng], { icon: L.divIcon({ className: '', html: '<div class="pin me"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false }).addTo(g);
    }
    if (fit && bounds.length > 1) m.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 16 });
    else if (fit && bounds.length === 1) m.setView(bounds[0], Math.max(m.getZoom(), 15));
  }, [markers, lines, me, fit]);

  useEffect(() => {
    if (center && map.current && !fit) map.current.setView([center.lat, center.lng], map.current.getZoom());
  }, [center?.lat, center?.lng, fit]);

  return <div ref={el} className={className} role="region" aria-label={label} />;
}
