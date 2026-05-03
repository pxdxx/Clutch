const saveBtn = document.getElementById('save');
const saveMsg = document.getElementById('saveMsg');

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock']);

const SAFE_SINGLE = new Set([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'PrintScreen', 'Pause', 'Insert',
]);

function keyToElectron(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('CommandOrControl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Super');

  const MAP = {
    ' ': 'Space',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5', F6: 'F6',
    F7: 'F7', F8: 'F8', F9: 'F9', F10: 'F10', F11: 'F11', F12: 'F12',
    Tab: 'Tab', Enter: 'Return', Backspace: 'Backspace', Delete: 'Delete',
    Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    PrintScreen: 'PrintScreen', Pause: 'Pause',
  };
  let key = e.key;
  if (MAP[key]) key = MAP[key];
  else if (key.length === 1) key = key.toUpperCase();
  else return null;

  parts.push(key);

  if (parts.length === 1 && !SAFE_SINGLE.has(key)) return null;

  return parts.join('+');
}

function electronToDisplay(acc) {
  if (!acc) return null;
  return acc
    .replace('CommandOrControl', 'Ctrl')
    .replace('Super', 'Win')
    .split('+');
}

function renderShortcut(el, acc) {
  el.innerHTML = '';
  if (!acc) {
    el.classList.add('empty');
    el.classList.remove('recording');
    el.textContent = 'не задано';
    return;
  }
  el.classList.remove('empty', 'recording');
  const parts = electronToDisplay(acc);
  parts.forEach((p, i) => {
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = p;
    el.appendChild(k);
    if (i < parts.length - 1) {
      const plus = document.createElement('span');
      plus.textContent = '+';
      plus.style.cssText = 'color:#52525b;font-size:10px;margin:0 1px';
      el.appendChild(plus);
    }
  });
}

function makeRecorder(el, onCommit) {
  let recording = false;

  function startRecording() {
    recording = true;
    el.classList.add('recording');
    el.innerHTML = '';
    el.textContent = 'нажмите клавиши…';
  }

  function stopRecording() {
    recording = false;
    el.classList.remove('recording');
  }

  el.addEventListener('click', () => {
    if (recording) return;
    startRecording();
  });

  el.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!recording) {
      startRecording();
      return;
    }

    if (e.key === 'Escape') {
      stopRecording();
      onCommit(null);
      return;
    }

    if (MODIFIER_KEYS.has(e.key)) return;

    const acc = keyToElectron(e);
    if (!acc) return;

    stopRecording();
    onCommit(acc);
  });

  el.addEventListener('blur', () => {
    if (recording) {
      stopRecording();
      onCommit('__cancel__');
    }
  });
}

const state = { quickShortcut: '', annotateShortcut: '' };

const quickEl = document.getElementById('quickShortcut');
const annEl = document.getElementById('annotateShortcut');

makeRecorder(quickEl, (acc) => {
  if (acc === '__cancel__') { renderShortcut(quickEl, state.quickShortcut); return; }
  state.quickShortcut = acc || '';
  renderShortcut(quickEl, state.quickShortcut);
});

makeRecorder(annEl, (acc) => {
  if (acc === '__cancel__') { renderShortcut(annEl, state.annotateShortcut); return; }
  state.annotateShortcut = acc || '';
  renderShortcut(annEl, state.annotateShortcut);
});

async function load() {
  const s = await window.api.settings.get();
  state.quickShortcut = s.quickShortcut || '';
  state.annotateShortcut = s.annotateShortcut || '';
  renderShortcut(quickEl, state.quickShortcut);
  renderShortcut(annEl, state.annotateShortcut);
}

saveBtn.addEventListener('click', async () => {
  await window.api.settings.set({
    quickShortcut: state.quickShortcut,
    annotateShortcut: state.annotateShortcut,
  });
  saveMsg.textContent = 'Сохранено';
  saveMsg.classList.add('show');
  clearTimeout(saveBtn._t);
  saveBtn._t = setTimeout(() => saveMsg.classList.remove('show'), 1400);
});

window.api.settings.onUpdated(() => load());

load();
