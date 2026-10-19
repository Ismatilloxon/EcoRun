const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';
export const API = `${BASE}/api/v1`;
export const assetUrl = (u?: string | null) => (!u ? '' : u.startsWith('http') ? u : `${BASE}${u}`);

export class ApiError extends Error {
  status: number;
  code: string;
  detail?: string;
  constructor(status: number, code: string, detail?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

type Tokens = { accessToken: string; refreshToken: string };
const store = {
  get(): Tokens | null {
    try {
      const raw = localStorage.getItem('tokens');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  set(t: Tokens | null) {
    try {
      if (t) localStorage.setItem('tokens', JSON.stringify(t));
      else localStorage.removeItem('tokens');
    } catch {
      /* private mode */
    }
  },
};

let tokens: Tokens | null = store.get();
let onLogout: (() => void) | null = null;
export const setLogoutHandler = (fn: () => void) => (onLogout = fn);
export const getAccessToken = () => tokens?.accessToken ?? null;
export const hasSession = () => Boolean(tokens);
export function setTokens(t: Tokens | null) {
  tokens = t;
  store.set(t);
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!tokens?.refreshToken) return false;
  refreshing ??= fetch(`${API}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      setTokens(await r.json());
      return true;
    })
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (tokens?.accessToken) headers.authorization = `Bearer ${tokens.accessToken}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (res.status === 401 && retry && tokens) {
    if (await refresh()) return request<T>(method, path, body, false);
    setTokens(null);
    onLogout?.();
  }
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? 'generic', (data as any)?.message);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T = any>(p: string, b?: unknown) => request<T>('PATCH', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: async (file: File | Blob) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ url: string; meta: Record<string, unknown> }>('POST', '/uploads', fd);
  },
  /** Authenticated file download (CSV, JSON export). */
  download: async (p: string, filename: string) => {
    const res = await fetch(`${API}${p}`, { headers: tokens ? { authorization: `Bearer ${tokens.accessToken}` } : {} });
    if (!res.ok) throw new ApiError(res.status, 'generic');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};

// ---------- Realtime ----------
type Listener = (msg: any) => void;
const listeners = new Set<Listener>();
let ws: WebSocket | null = null;
let rooms = new Set<string>();
let backoff = 1000;

export function connectRealtime() {
  if (!tokens || (ws && ws.readyState <= 1)) return;
  const url = BASE ? `${BASE.replace(/^http/, 'ws')}/api/v1/ws` : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    backoff = 1000;
    ws!.send(JSON.stringify({ type: 'auth', token: tokens?.accessToken }));
  };
  ws.onmessage = (e) => {
    let msg: any;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') for (const r of rooms) ws!.send(JSON.stringify({ type: 'join', runId: r }));
    for (const l of listeners) l(msg);
  };
  ws.onclose = (e) => {
    ws = null;
    if (e.code === 4001) {
      refresh().then((ok) => ok && setTimeout(connectRealtime, 200));
      return;
    }
    if (tokens) setTimeout(connectRealtime, (backoff = Math.min(backoff * 2, 30000)));
  };
}

export function disconnectRealtime() {
  rooms = new Set();
  ws?.close();
  ws = null;
}

export function joinRoom(runId: string) {
  rooms.add(runId);
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'join', runId }));
}

export function onRealtime(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
