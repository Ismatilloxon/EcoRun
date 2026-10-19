import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, joinRoom, onRealtime } from '../api.ts';
import { fmtTime } from '../lib/format.ts';
import { useApp, useLoad } from '../store.tsx';
import { Icon } from '../ui/Icon.tsx';
import { Empty, ErrorBox, Loading, NavBar, Sheet, Switch } from '../ui/ui.tsx';
import { ReportSheet } from './Social.tsx';

type Msg = { id: number; body: string; is_announcement: boolean; created_at: string; user: { id: string; name: string | null } };

export function Chat() {
  const { id } = useParams();
  const { t, lang, me, toast, errorText } = useApp();
  const [run] = useLoad<any>(() => api.get(`/runs/${id}`), [id]);
  const [msgs, loading, error, reload, setMsgs] = useLoad<Msg[]>(() => api.get(`/runs/${id}/messages`), [id]);
  const [text, setText] = useState('');
  const [ann, setAnn] = useState(false);
  const [sel, setSel] = useState<Msg | null>(null);
  const [report, setReport] = useState<Msg | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const list = useRef<Msg[]>([]);
  list.current = msgs ?? [];

  useEffect(() => {
    if (!id) return;
    joinRoom(id);
    return onRealtime((m) => {
      if (m.runId !== id) return;
      if (m.type === 'message' && !list.current.some((x) => x.id === m.message.id)) setMsgs([...list.current, m.message]);
      if (m.type === 'message_deleted') setMsgs(list.current.filter((x) => x.id !== m.id));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [msgs?.length]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    try {
      const m = await api.post<Msg>(`/runs/${id}/messages`, { body, announcement: ann });
      if (!list.current.some((x) => x.id === m.id)) setMsgs([...list.current, m]);
      setAnn(false);
    } catch (e) {
      setText(body);
      toast(errorText(e), 'error');
    }
  };

  return (
    <main className="screen no-tab tight" style={{ paddingBottom: 0 }}>
      <NavBar back={`/runs/${id}`} title={run?.title ?? t('chat.title')} />
      {loading && !msgs ? <Loading /> : error ? <ErrorBox error={error} retry={reload} /> : (
        <div className="chat" style={{ flex: 1 }}>
          {!msgs?.length && <Empty icon="chat" text={t('chat.empty')} />}
          {msgs?.map((m) => {
            const mine = m.user.id === me?.id;
            return (
              <button
                key={m.id}
                type="button"
                className={`bubble ${m.is_announcement ? 'ann' : mine ? 'mine' : ''}`}
                style={{ border: 0, textAlign: 'left', font: 'inherit', cursor: 'pointer', color: 'inherit' }}
                onClick={() => setSel(m)}
              >
                {(!mine || m.is_announcement) && (
                  <span className="who">
                    {m.is_announcement && <><Icon name="megaphone" size={12} /> {t('chat.announcement')} · </>}
                    {m.user.name}
                  </span>
                )}
                <span style={{ display: 'block', whiteSpace: 'pre-wrap' }}>{m.body}</span>
                <span className="caption" style={{ color: 'inherit', opacity: 0.7 }}>{fmtTime(m.created_at, lang)}</span>
              </button>
            );
          })}
          <div ref={bottom} />
        </div>
      )}
      <form className="composer col" style={{ gap: 6, alignItems: 'stretch' }} onSubmit={(e) => { e.preventDefault(); send(); }}>
        {run?.can_manage && (
          <label className="row-flex footnote" style={{ gap: 8 }}>
            <Switch checked={ann} onChange={setAnn} label={t('run.announce')} /> {t('run.announce')}
          </label>
        )}
        <div className="row-flex" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label htmlFor="chat-input" className="sr-only">{t('chat.placeholder')}</label>
          <textarea
            id="chat-input"
            rows={1}
            maxLength={2000}
            placeholder={t('chat.placeholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="icon-btn accent" aria-label={t('common.send')} disabled={!text.trim()} style={{ background: 'var(--accent-bg)', color: '#fff', border: 0 }}>
            <Icon name="send" size={20} />
          </button>
        </div>
      </form>
      <Sheet open={Boolean(sel)} onClose={() => setSel(null)}>
        <div className="col" style={{ gap: 8 }}>
          <button className="btn gray" onClick={() => { navigator.clipboard?.writeText(sel?.body ?? ''); toast(t('common.copied')); setSel(null); }}>{t('common.copy')}</button>
          {sel && (sel.user.id === me?.id || run?.can_manage) && (
            <button className="btn danger" onClick={async () => { await api.del(`/runs/${id}/messages/${sel.id}`).catch(() => {}); setMsgs(list.current.filter((x) => x.id !== sel.id)); setSel(null); }}>{t('common.delete')}</button>
          )}
          {sel && sel.user.id !== me?.id && <button className="btn danger" onClick={() => { setReport(sel); setSel(null); }}>{t('rp.title')}</button>}
        </div>
      </Sheet>
      <ReportSheet open={Boolean(report)} onClose={() => setReport(null)} targetType="message" targetId={String(report?.id ?? '')} />
    </main>
  );
}
