// Lazy chunk: rrweb replayer + remote-control event capture.
import { Replayer } from 'rrweb';

export type Viewer = {
  addEvent(event: any): void;
  destroy(): void;
};

export function createViewer(
  root: HTMLElement,
  opts: { canControl: boolean; onControl: (control: any) => void },
): Viewer {
  root.innerHTML = '';
  const replayer = new Replayer([], {
    root,
    liveMode: true,
    pauseAnimation: false,
    mouseTail: false,
    showDebug: false,
    showWarning: false,
  });
  replayer.startLive();
  replayer.enableInteract();

  let capture: AbortController | null = null;

  // A full snapshot rebuild calls document.open(), which drops listeners.
  // Re-install capture every time rrweb rebuilds, on the iframe window.
  const attach = () => {
    capture?.abort();
    capture = null;
    if (!opts.canControl) return;
    const win = replayer.iframe.contentWindow;
    if (!win) return;
    const ac = new AbortController();
    capture = ac;
    attachControlCapture(replayer, win, opts.onControl, ac.signal);
  };

  replayer.on('fullsnapshot-rebuilded', attach);
  attach();

  return {
    addEvent(event: any) {
      replayer.addEvent(event);
    },
    destroy() {
      capture?.abort();
      replayer.off('fullsnapshot-rebuilded', attach);
      try {
        replayer.destroy();
      } catch {
        /* already gone */
      }
      root.innerHTML = '';
    },
  };
}

function nodeId(replayer: Replayer, target: EventTarget | null): number | undefined {
  // Nodes inside the replayer iframe belong to another realm, so instanceof
  // checks against the parent window's Node constructor do not work.
  if (!target || typeof (target as any).nodeType !== 'number') return undefined;
  try {
    const id = replayer.getMirror().getId(target as Node);
    return typeof id === 'number' ? id : undefined;
  } catch {
    return undefined;
  }
}

function attachControlCapture(
  replayer: Replayer,
  win: Window,
  send: (control: any) => void,
  signal: AbortSignal,
): void {
  const opts = { capture: true, signal };

  win.addEventListener(
    'click',
    (e) => {
      const me = e as MouseEvent;
      const target = me.target as Element | null;
      // Never let the clone navigate/submit on its own; the real page does that.
      if (target && target.closest && target.closest('a[href],button[type="submit"],input[type="submit"]')) {
        me.preventDefault();
      }
      send({
        kind: 'click',
        id: nodeId(replayer, me.target),
        x: me.clientX,
        y: me.clientY,
      });
    },
    opts,
  );

  const sendValue = (e: Event, kind: string) => {
    const t = e.target as any;
    if (!t) return;
    send({
      kind,
      id: nodeId(replayer, t),
      value: t.value ?? t.textContent ?? '',
      checked: !!t.checked,
    });
  };

  win.addEventListener('input', (e) => sendValue(e, 'input'), opts);
  win.addEventListener('change', (e) => sendValue(e, 'change'), opts);

  win.addEventListener(
    'keydown',
    (e) => {
      const k = e as KeyboardEvent;
      send({
        kind: 'key',
        id: nodeId(replayer, k.target),
        key: k.key,
        code: k.code,
        keyCode: k.keyCode,
        ctrlKey: k.ctrlKey,
        shiftKey: k.shiftKey,
        altKey: k.altKey,
        metaKey: k.metaKey,
      });
    },
    opts,
  );

  win.addEventListener(
    'scroll',
    (e) => {
      const doc = win.document;
      const t = e.target as any;
      const isDoc = t === doc || t === doc.documentElement || t === doc.body || t === win;
      send({
        kind: 'scroll',
        id: isDoc ? undefined : nodeId(replayer, t),
        x: isDoc ? win.scrollX : t.scrollLeft,
        y: isDoc ? win.scrollY : t.scrollTop,
      });
    },
    opts,
  );
}
