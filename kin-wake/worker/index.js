// KIN Wake API. Do not put PIN or webhook values in this file.
const PAGE_ORIGIN = 'https://shirokinstudio.github.io';
const API_BASE = '/api/';
const encoder = new TextEncoder();

function response(request, value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': PAGE_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Vary': 'Origin',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) throw Error('Invalid base64');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}
function secureCompare(a, b) {
  const x = encoder.encode(a), y = encoder.encode(b);
  let result = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    result |= (x[i] || 0) ^ (y[i] || 0);
  }
  return result === 0;
}
async function signingKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function issueToken(secret) {
  const expiry = Date.now() + 30 * 60 * 1000;
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = base64url(encoder.encode(String(expiry) + ':' + nonce));
  const signature = await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(payload));
  return payload + '.' + base64url(new Uint8Array(signature));
}
async function verifyToken(token, secret) {
  if (typeof token !== 'string' || token.length > 1024) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    const payloadBytes = unbase64url(parts[0]);
    const payload = new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes);
    const [expiryText, nonce] = payload.split(':');
    if (!/^\d{13}$/.test(expiryText) || !nonce || nonce.length < 16) return false;
    const expiry = Number(expiryText);
    if (expiry < Date.now() || expiry > Date.now() + 30 * 60 * 1000) return false;
    return crypto.subtle.verify('HMAC', await signingKey(secret), unbase64url(parts[1]), encoder.encode(parts[0]));
  } catch {
    return false;
  }
}
function validWebhook(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'trigger.macrodroid.com' &&
      !url.username && !url.password && !url.hash &&
      url.pathname.split('/').filter(Boolean).length >= 2;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/api/health' && request.method === 'GET') {
      return response(request, { service: 'KIN Wake API', live: true });
    }
    if (!pathname.startsWith(API_BASE)) return response(request, { error: 'Not found' }, 404);
    const origin = request.headers.get('Origin');
    if (origin !== PAGE_ORIGIN) return response(request, { error: 'Forbidden origin' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': PAGE_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin'
      }
    });
    if (request.method !== 'POST') return response(request, { error: 'Method not allowed' }, 405);
    if (!env.KIN_WAKE_PIN || !env.KIN_WAKE_WEBHOOK || !env.KIN_WAKE_SESSION_KEY ||
        !env.PIN_LIMITER || !env.WAKE_LIMITER || !validWebhook(env.KIN_WAKE_WEBHOOK)) {
      return response(request, { error: 'Service is not configured' }, 503);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (pathname === '/api/session') {
      // PIN guesses are limited to five attempts per minute per IP.
      const allowed = await env.PIN_LIMITER.limit({ key: 'pin:' + ip });
      if (!allowed.success) return response(request, { error: 'Too many attempts. Try later.' }, 429);
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > 1024) return response(request, { error: 'Invalid input' }, 413);
      let pin = null;
      try {
        const body = await request.json();
        pin = typeof body.pin === 'string' && body.pin.length <= 256 ? body.pin : null;
      } catch {}
      if (pin === null || !secureCompare(pin, env.KIN_WAKE_PIN)) {
        return response(request, { error: 'Incorrect PIN' }, 401);
      }
      return response(request, { token: await issueToken(env.KIN_WAKE_SESSION_KEY), expiresIn: 1800 });
    }

    if (pathname === '/api/wake') {
      const auth = request.headers.get('Authorization') || '';
      if (!auth.startsWith('Bearer ') || !(await verifyToken(auth.slice(7), env.KIN_WAKE_SESSION_KEY))) {
        return response(request, { error: 'PIN login required or session expired' }, 401);
      }
      const allowed = await env.WAKE_LIMITER.limit({ key: 'wake:' + ip });
      if (!allowed.success) return response(request, { error: 'Too many wake requests' }, 429);
      try {
        const r = await fetch(env.KIN_WAKE_WEBHOOK, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          headers: { 'Accept': 'text/plain' }
        });
        if (!r.ok) return response(request, { error: 'Webhook provider rejected request' }, 502);
        // This only confirms MacroDroid endpoint HTTP acceptance, not PC power-on.
        return response(request, { queued: true, verified: false });
      } catch {
        return response(request, { error: 'Webhook could not be reached' }, 502);
      }
    }
    return response(request, { error: 'Not found' }, 404);
  }
};
