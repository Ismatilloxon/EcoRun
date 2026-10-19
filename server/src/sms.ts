import { config } from './config.ts';

// Eskiz.uz SMS gateway. Token is cached and refreshed on 401.
let token: string | null = null;

async function login() {
  const form = new FormData();
  form.set('email', config.eskiz.email);
  form.set('password', config.eskiz.password);
  const res = await fetch('https://notify.eskiz.uz/api/auth/login', { method: 'POST', body: form, signal: AbortSignal.timeout(8000) });
  const json: any = await res.json();
  token = json?.data?.token ?? null;
  return token;
}

export async function sendSms(phone: string, text: string, retry = true): Promise<boolean> {
  try {
    if (!token) await login();
    if (!token) return false;
    const form = new FormData();
    form.set('mobile_phone', phone.replace(/^\+/, ''));
    form.set('message', text);
    form.set('from', config.eskiz.from);
    const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 && retry) {
      token = null;
      return sendSms(phone, text, false);
    }
    return res.ok;
  } catch (e) {
    console.warn('[sms] failed', (e as Error).message);
    return false;
  }
}
