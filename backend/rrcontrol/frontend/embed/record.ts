// Lazy chunk: only loaded after a controller starts watching.
import { record } from 'rrweb';

let stopFn: (() => void) | null = null;

export function startRecording(emit: (event: unknown) => void): void {
  if (stopFn) return;
  stopFn =
    record({
      emit: (event) => emit(event),
      blockClass: 'rrw-block',
      maskAllInputs: false,
      recordCanvas: false,
    }) || null;
}

export function stopRecording(): void {
  if (stopFn) {
    stopFn();
    stopFn = null;
  }
}

function nodeById(id: unknown): any {
  if (typeof id !== 'number') return null;
  try {
    return (record as any).mirror.getNode(id);
  } catch {
    return null;
  }
}

export function applyControl(control: any): void {
  if (!control) return;
  const el = nodeById(control.id);
  switch (control.kind) {
    case 'click': {
      const target = el || document.elementFromPoint(control.x || 0, control.y || 0);
      if (target) clickElement(target, control);
      break;
    }
    case 'input':
    case 'change':
      if (el) setValue(el, control);
      break;
    case 'key':
      dispatchKey(el || document.activeElement || document.body, control);
      break;
    case 'scroll':
      scrollElement(el, control);
      break;
  }
}

function clickElement(target: Element, control: any): void {
  const view = target.ownerDocument.defaultView || window;
  const base = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: control.x || 0,
    clientY: control.y || 0,
    button: 0,
  };
  try {
    target.dispatchEvent(new PointerEvent('pointerdown', { ...base, pointerId: 1, isPrimary: true }));
  } catch {
    /* older browsers */
  }
  target.dispatchEvent(new MouseEvent('mousedown', base));
  try {
    target.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerId: 1, isPrimary: true }));
  } catch {
    /* older browsers */
  }
  target.dispatchEvent(new MouseEvent('mouseup', base));
  if (typeof (target as any).click === 'function') (target as any).click();
  else target.dispatchEvent(new MouseEvent('click', base));
}

function setValue(el: any, control: any): void {
  if (el.type === 'checkbox' || el.type === 'radio') {
    el.checked = !!control.checked;
  } else if (el.isContentEditable) {
    el.textContent = control.value ?? '';
  } else if ('value' in el) {
    el.value = control.value ?? '';
  } else {
    return;
  }
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function dispatchKey(target: any, control: any): void {
  if (!target || typeof target.dispatchEvent !== 'function') return;
  const init: KeyboardEventInit = {
    key: control.key,
    code: control.code,
    keyCode: control.keyCode,
    which: control.keyCode,
    bubbles: true,
    cancelable: true,
    composed: true,
    ctrlKey: !!control.ctrlKey,
    shiftKey: !!control.shiftKey,
    altKey: !!control.altKey,
    metaKey: !!control.metaKey,
  } as KeyboardEventInit;
  target.dispatchEvent(new KeyboardEvent('keydown', init));
  target.dispatchEvent(new KeyboardEvent('keyup', init));
}

function scrollElement(el: any, control: any): void {
  const x = control.x || 0;
  const y = control.y || 0;
  if (el && typeof el.scrollTo === 'function') {
    el.scrollTo({ left: x, top: y });
  } else {
    window.scrollTo({ left: x, top: y });
  }
}
