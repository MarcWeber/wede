// Entry point of the embeddable /script.js payload.
// It is intentionally tiny: rrweb is only imported lazily when somebody
// actually starts watching this page.

const here = new URL(import.meta.url);
const serverOrigin = here.origin;
const sessionKey = 'rrw_session_id';
const identityKeys = ['rrweb-remote-access', 'rrweb_remote_access', 'tab_id'];
let who = here.searchParams.get('who') || 'anonymous-' + randomId(4);
let tabID = storedIdentity() || explicitIdentity() || '';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let recordMod: typeof import('./record') | null = null;
let watching = false;
let controlEnabled = false;
let badge: HTMLDivElement | null = null;

function randomId(len: number): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function explicitIdentity(): string | null {
  for (const key of identityKeys) {
    const value = here.searchParams.get(key) || new URL(location.href).searchParams.get(key);
    if (value && value.trim()) return value.trim();
  }
  return null;
}

function storedIdentity(): string | null {
  try {
    const value = sessionStorage.getItem(sessionKey);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

function persistIdentity(id: string): void {
  if (!id) return;
  tabID = id;
  try {
    sessionStorage.setItem(sessionKey, id);
  } catch {
    /* storage unavailable */
  }
  if ((window as any).__rrwebRemote) (window as any).__rrwebRemote.tabID = id;
}

persistIdentity(tabID);

function socketUrl(): string {
  const proto = serverOrigin.startsWith('https:') ? 'wss:' : 'ws:';
  const url = new URL('../ws', here);
  url.protocol = proto;
  url.searchParams.set('role', 'client');
  if (tabID) {
    url.searchParams.set('id', tabID);
    url.searchParams.set('tab_id', tabID);
  }
  url.searchParams.set('who', who);
  return url.toString();
}

function send(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(): void {
  ws = new WebSocket(socketUrl());

  ws.onopen = () => {
    send({
      type: 'hello',
      who,
      url: location.href,
      title: document.title,
    });
  };

  ws.onmessage = async (ev: MessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    switch (msg.type) {
      case 'identity':
        if (typeof msg.id === 'string') persistIdentity(msg.id);
        break;
      case 'watch-request':
        showInvite();
        break;
      case 'watch-start':
        if (typeof msg.id === 'string') persistIdentity(msg.id);
        await startWatching(msg);
        break;
      case 'full-snapshot':
        if (watching && recordMod) recordMod.takeFullSnapshot();
        break;
      case 'watch-stop':
        stopWatching();
        break;
      case 'control':
        if (controlEnabled && recordMod) recordMod.applyControl(msg.control);
        break;
    }
  };

  ws.onclose = () => {
    stopWatching();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };
}

async function startWatching(msg: any): Promise<void> {
  if (!recordMod) recordMod = await import('./record');
  document.getElementById('rrw-invite')?.remove();
  controlEnabled = !!msg.canControl;
  if (watching) {
    setBadge(controlEnabled);
    return;
  }
  watching = true;
  recordMod.startRecording((event) => send({ type: 'rrweb', event }));
  setBadge(controlEnabled);
}

function stopWatching(): void {
  watching = false;
  controlEnabled = false;
  if (recordMod) recordMod.stopRecording();
  setBadge(false);
}

function destroy(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  stopWatching();
}

function ensureBadge(): HTMLDivElement {
  if (badge) return badge;
  badge = document.createElement('div');
  badge.className = 'rrw-block';
  badge.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:14px',
    'z-index:2147483647',
    'font:12px/1.4 system-ui,sans-serif',
    'padding:8px 12px',
    'border-radius:8px',
    'background:#111',
    'color:#fff',
    'box-shadow:0 4px 18px rgba(0,0,0,.3)',
    'max-width:320px',
  ].join(';');
  (document.body || document.documentElement).appendChild(badge);
  return badge;
}

function setBadge(control: boolean): void {
  if (!watching) {
    if (badge) {
      badge.remove();
      badge = null;
    }
    return;
  }
  const el = ensureBadge();
  el.textContent = control
    ? 'Support is watching and can control this page'
    : 'Support is watching this page';
}

function showInvite(): void {
  if (document.getElementById('rrw-invite')) return;
  const box = document.createElement('div');
  box.id = 'rrw-invite';
  box.className = 'rrw-block';
  box.style.cssText = [
    'position:fixed',
    'right:14px',
    'bottom:14px',
    'z-index:2147483647',
    'font:13px/1.45 system-ui,sans-serif',
    'padding:14px 16px',
    'border-radius:10px',
    'background:#111',
    'color:#fff',
    'box-shadow:0 6px 24px rgba(0,0,0,.35)',
    'max-width:340px',
  ].join(';');

  const text = document.createElement('div');
  text.textContent = 'Support would like to view this page. Allow?';
  text.style.marginBottom = '10px';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';

  const deny = document.createElement('button');
  deny.textContent = 'Deny';
  deny.style.cssText =
    'font:inherit;padding:6px 12px;border-radius:6px;border:1px solid #555;background:#222;color:#eee;cursor:pointer';

  const allow = document.createElement('button');
  allow.textContent = 'Allow';
  allow.style.cssText =
    'font:inherit;padding:6px 12px;border-radius:6px;border:0;background:#2f81f7;color:#fff;cursor:pointer';

  const finish = (accepted: boolean) => {
    box.remove();
    send({ type: 'invite-response', accepted });
  };

  deny.onclick = () => finish(false);
  allow.onclick = () => finish(true);

  row.append(deny, allow);
  box.append(text, row);
  (document.body || document.documentElement).appendChild(box);
}

connect();

// Small helper so the host page can inspect the connection during a demo.
(window as any).__rrwebRemote = {
  who,
  tabID,
  setWho: (nextWho: string) => {
    who = String(nextWho || '').trim();
    (window as any).__rrwebRemote.who = who;
    send({ type: 'who-update', who });
  },
  isWatching: () => watching,
  canControl: () => controlEnabled,
  destroy,
};

const wedeWho = (window as any).__wedeRRControlWho;
if (typeof wedeWho === 'string' && wedeWho.trim()) (window as any).__rrwebRemote.setWho(wedeWho);
