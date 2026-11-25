// Remote-control console: lists connected pages and opens a live rrweb viewer.

type ClientInfo = {
  id: string;
  tab_id: string;
  who: string;
  url: string;
  title: string;
  watching: boolean;
  watchers: number;
};

type Viewer = { addEvent(event: any): void; destroy(): void };

type WatchStats = {
  events: number;
  payload: number;
  pageUp: number;
  pageDown: number;
  viewerUp: number;
  viewerDown: number;
  compressed: boolean;
};

const el = {
  connState: document.getElementById('conn-state') as HTMLElement,
  clients: document.getElementById('clients') as HTMLElement,
  clientCount: document.getElementById('client-count') as HTMLElement,
  empty: document.getElementById('empty') as HTMLElement,
  placeholder: document.getElementById('placeholder') as HTMLElement,
  viewer: document.getElementById('viewer') as HTMLElement,
  toolbar: document.getElementById('toolbar') as HTMLElement,
  status: document.getElementById('status') as HTMLElement,
  stats: document.getElementById('stats') as HTMLElement,
  pageLink: document.getElementById('page-link') as HTMLAnchorElement,
  stopBtn: document.getElementById('stop-btn') as HTMLButtonElement,
};

const requestedTarget = new URLSearchParams(location.search).get('watch');
const viewerOnly = !!requestedTarget;
document.body.classList.toggle('viewer-only', viewerOnly);
if (viewerOnly) {
  const heading = el.placeholder.querySelector('h1');
  const description = el.placeholder.querySelector('p');
  if (heading) heading.textContent = 'Waiting for the page to connect';
  if (description) description.textContent = 'This viewer will start automatically when the page is online.';
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let clients: ClientInfo[] = [];
let selected: string | null = null;
let viewer: Viewer | null = null;
let viewerGen = 0;
let pendingEvents: any[] = [];
let requestedWatchStarted = false;
let authToken = '';

function socketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = new URL('../ws', import.meta.url);
  url.protocol = proto;
  url.searchParams.set('role', 'support');
  return url.toString();
}

function send(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect(): void {
  if (!authToken) return;
  setConn('connecting…');
  ws = new WebSocket(socketUrl(), [`auth.${authToken}`]);

  ws.onopen = () => {
    setConn('connected');
    send({ type: 'list-request' });
  };

  ws.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    handle(msg);
  };

  ws.onerror = () => {
    setConn('WebSocket error; waiting for close details…');
  };

  ws.onclose = (event) => {
    const detail = `code ${event.code}${event.reason ? `: ${event.reason}` : ''}`;
    setConn(authToken ? `reconnecting… (${detail})` : `disconnected (${detail})`);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (authToken) reconnectTimer = setTimeout(connect, 2500);
  };
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window.parent || event.origin !== location.origin) return;
  const message = event.data as { type?: string; token?: string };
  if (message?.type !== 'wede-rrcontrol-auth' || typeof message.token !== 'string' || !message.token) return;
  if (message.token === authToken) return;
  authToken = message.token;
  if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  else connect();
});

function setConn(text: string): void {
  el.connState.textContent = text;
  el.connState.dataset.state = text;
}

function handle(msg: any): void {
  switch (msg.type) {
    case 'list':
      clients = Array.isArray(msg.clients) ? msg.clients : [];
      renderList();
      if (requestedTarget && !requestedWatchStarted) {
        const target = clients.find((client) => client.id === requestedTarget);
        if (target) {
          requestedWatchStarted = true;
          selectClient(target.id);
        }
      }
      if (selected && !clients.some((c) => c.id === selected)) {
        teardownViewer();
        selected = null;
        showPlaceholder();
      }
      break;
    case 'watch-pending':
      setStatus('Waiting for the visitor to allow access…');
      if (viewerOnly) {
        showViewerMessage(
          'Waiting for approval',
          'The visitor must allow access before the page can be shown.',
        );
      }
      break;
    case 'watch-started':
      if (msg.target !== selected) return;
      onWatchStarted(msg);
      break;
    case 'watch-denied':
      setStatus('Visitor denied access.');
      teardownViewer();
      selected = null;
      renderList();
      if (viewerOnly) {
        showViewerMessage(
          'Access was denied',
          'The visitor did not allow this page to be viewed.',
        );
      }
      break;
    case 'client-gone':
      if (msg.target === selected) {
        setStatus('The page disconnected.');
        teardownViewer();
        selected = null;
        showPlaceholder();
      }
      break;
    case 'rrweb':
      if (msg.event) {
        if (viewer) viewer.addEvent(msg.event);
        else pendingEvents.push(msg.event);
      }
      break;
    case 'stats':
      if (msg.target === selected) updateStats(msg);
      break;
    case 'control-denied':
      setStatus('Control is disabled by server policy.');
      break;
  }
}

async function onWatchStarted(msg: any): Promise<void> {
  const info = clients.find((c) => c.id === msg.target);
  const canControl = !!msg.canControl;
  setStatus(canControl ? 'Control enabled' : 'View only');
  setPageLink(msg.who || info?.who || 'unknown', msg.url || info?.url || '');
  startStatsPolling();

  el.placeholder.hidden = true;
  el.viewer.hidden = false;
  el.toolbar.hidden = false;

  const gen = ++viewerGen;
  pendingEvents = [];
  try {
    const mod = await import('./viewer');
    if (gen !== viewerGen) return;
    viewer = mod.createViewer(el.viewer, {
      canControl,
      onControl: (control) => send({ type: 'control', control }),
    });
    for (const event of pendingEvents) viewer.addEvent(event);
    pendingEvents = [];
  } catch (err) {
    setStatus('Failed to load viewer: ' + String(err));
  }
}

function selectClient(id: string): void {
  if (selected === id) {
    stopWatching();
    return;
  }
  send({ type: 'unwatch' });
  teardownViewer();
  selected = id;
  pendingEvents = [];
  renderList();
  el.placeholder.hidden = true;
  el.viewer.hidden = false;
  el.toolbar.hidden = false;
  setStatus('Requesting access…');
  send({ type: 'watch', target: id });
}

function stopWatching(): void {
  send({ type: 'unwatch' });
  teardownViewer();
  selected = null;
  renderList();
  showPlaceholder();
}

function teardownViewer(): void {
  viewerGen++;
  pendingEvents = [];
  stopStatsPolling();
  if (viewer) {
    viewer.destroy();
    viewer = null;
  }
  el.viewer.innerHTML = '';
  el.stats.textContent = '';
  el.pageLink.hidden = true;
  el.pageLink.removeAttribute('href');
}

function showPlaceholder(): void {
  el.placeholder.hidden = false;
  el.viewer.hidden = true;
  el.toolbar.hidden = true;
  setStatus('');
}

function showViewerMessage(title: string, description: string): void {
  const heading = el.placeholder.querySelector('h1');
  const text = el.placeholder.querySelector('p');
  if (heading) heading.textContent = title;
  if (text) text.textContent = description;
  el.placeholder.hidden = false;
  el.viewer.hidden = true;
  el.toolbar.hidden = true;
}

function setStatus(text: string): void {
  el.status.textContent = text;
}

function setPageLink(who: string, url: string): void {
  el.pageLink.textContent = who;
  try {
    const parsed = new URL(url, location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('unsupported URL');
    el.pageLink.href = parsed.href;
    el.pageLink.hidden = false;
  } catch {
    el.pageLink.hidden = true;
    el.pageLink.removeAttribute('href');
  }
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function updateStats(stats: WatchStats): void {
  el.stats.textContent =
    `page ↑ ${formatBytes(stats.pageUp)} ↓ ${formatBytes(stats.pageDown)} · ` +
    `viewer ↑ ${formatBytes(stats.viewerUp)} ↓ ${formatBytes(stats.viewerDown)} · ` +
    `${stats.events} events / ${formatBytes(stats.payload)} rrweb · ` +
    (stats.compressed ? 'compression on' : 'compression off');
}

function startStatsPolling(): void {
  stopStatsPolling();
  const request = () => {
    if (selected) send({ type: 'stats-request' });
  };
  request();
  statsTimer = setInterval(request, 1000);
}

function stopStatsPolling(): void {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
}

function renderList(): void {
  el.clientCount.textContent = String(clients.length);
  el.empty.hidden = clients.length > 0;
  el.clients.innerHTML = '';

  for (const client of clients) {
    const row = document.createElement('a');
    row.className = 'client' + (client.id === selected ? ' selected' : '');
    row.dataset.id = client.id;
    const watchURL = new URL(location.href);
    watchURL.search = '';
    watchURL.searchParams.set('watch', client.id);
    row.href = watchURL.toString();

    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = client.who || 'unknown';

    if (client.watching) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent =
        'watching' + (client.watchers > 1 ? ` ×${client.watchers}` : '');
      who.appendChild(badge);
    }

    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = client.title ? client.title + ' — ' : '';
    meta.textContent = title + (client.url || '');
    meta.title = client.url || '';

    row.append(who, meta);
    row.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      selectClient(client.id);
    });
    el.clients.appendChild(row);
  }
}

el.stopBtn.addEventListener('click', stopWatching);
if (window.parent === window) {
  authToken = localStorage.getItem('wede_token') || sessionStorage.getItem('wede_token') || '';
  if (!authToken) {
    setConn('No shared Wede session found');
    if (viewerOnly) {
      showViewerMessage(
      'No shared Wede login found',
      'Sign in to Wede, or reload an already signed-in Wede tab once to migrate its login, then reload this viewer.',
    );
    }
  }
}
connect();
