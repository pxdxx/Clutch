const bgCv = document.getElementById('bgCv');
const annCv = document.getElementById('annCv');
const selDiv = document.getElementById('sel');
const toolbar = document.getElementById('toolbar');
const hint = document.getElementById('hint');
const colorPicker = document.getElementById('colorPicker');
const swatch = document.getElementById('swatch');
const bgCtx = bgCv.getContext('2d');
const annCtx = annCv.getContext('2d');

let phase = 'idle';
let mode = 'quick';
let W = 0, H = 0;
let scaleX = 1, scaleY = 1;
let bgImg = null;
let sel = null;
let tool = 'arrow';
let color = '#ef4444';
let strokes = [];
let draft = null;
let dragging = false;
let sx0 = 0, sy0 = 0;

swatch.style.background = color;
colorPicker.value = color;
colorPicker.addEventListener('input', () => { color = colorPicker.value; swatch.style.background = color; });

window.api.overlay.onSetup(async (data) => {
  await setup(data);
});

window.api.overlay.onReset(() => {
  fullReset();
});

async function setup(data) {
  mode = data.mode;
  W = data.windowW;
  H = data.windowH;
  scaleX = data.imgW / W;
  scaleY = data.imgH / H;

  bgCv.width = W; bgCv.height = H;
  bgCv.style.width = W + 'px'; bgCv.style.height = H + 'px';
  annCv.width = W; annCv.height = H;
  annCv.style.width = W + 'px'; annCv.style.height = H + 'px';

  bgImg = new Image();
  await new Promise((res) => { bgImg.onload = res; bgImg.src = data.dataUrl; });

  bgCtx.clearRect(0, 0, W, H);
  bgCtx.drawImage(bgImg, 0, 0, W, H);
  bgCtx.fillStyle = 'rgba(0,0,0,0.46)';
  bgCtx.fillRect(0, 0, W, H);

  annCtx.clearRect(0, 0, W, H);
  strokes = []; draft = null;

  phase = 'selecting';
  selDiv.style.display = 'none';
  toolbar.style.display = 'none';
  hint.style.display = 'block';
  annCv.style.pointerEvents = 'none';
  document.body.style.cursor = 'crosshair';

  window.api.overlay.ready();
}

function fullReset() {
  phase = 'idle';
  sel = null; strokes = []; draft = null;
  selDiv.style.display = 'none';
  toolbar.style.display = 'none';
  hint.style.display = 'none';
  bgCtx.clearRect(0, 0, W, H);
  annCtx.clearRect(0, 0, W, H);
  annCv.style.pointerEvents = 'none';
}

document.querySelectorAll('.tbBtn[data-tool]').forEach((b) => {
  b.addEventListener('click', () => {
    tool = b.dataset.tool;
    document.querySelectorAll('.tbBtn[data-tool]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
});

bgCv.addEventListener('mousedown', (e) => {
  if (phase !== 'selecting') return;
  dragging = true;
  sx0 = e.clientX; sy0 = e.clientY;
  selDiv.style.display = 'none';
});

window.addEventListener('mousemove', (e) => {
  if (phase !== 'selecting' || !dragging) return;
  const x = Math.min(sx0, e.clientX);
  const y = Math.min(sy0, e.clientY);
  const w = Math.abs(e.clientX - sx0);
  const h = Math.abs(e.clientY - sy0);
  selDiv.style.left = x + 'px'; selDiv.style.top = y + 'px';
  selDiv.style.width = w + 'px'; selDiv.style.height = h + 'px';
  if (w > 2 && h > 2) selDiv.style.display = 'block';
});

window.addEventListener('mouseup', async (e) => {
  if (phase === 'selecting' && dragging) {
    dragging = false;
    const x = Math.min(sx0, e.clientX);
    const y = Math.min(sy0, e.clientY);
    const w = Math.abs(e.clientX - sx0);
    const h = Math.abs(e.clientY - sy0);
    if (w < 3 || h < 3) { selDiv.style.display = 'none'; return; }
    sel = { x, y, w, h };
    hint.style.display = 'none';
    if (mode === 'quick') {
      await commit('copy');
    } else {
      enterAnnotating();
    }
    return;
  }

  if (phase === 'annotating' && draft) {
    commitDraft();
  }
});

function enterAnnotating() {
  phase = 'annotating';
  selDiv.style.display = 'none';
  annCv.style.pointerEvents = 'auto';
  document.body.style.cursor = 'default';

  redrawBg();
  positionToolbar();
  toolbar.style.display = 'flex';
}

function redrawBg() {
  bgCtx.clearRect(0, 0, W, H);
  bgCtx.drawImage(bgImg, 0, 0, W, H);
  bgCtx.fillStyle = 'rgba(0,0,0,0.5)';
  bgCtx.fillRect(0, 0, W, H);
  bgCtx.save();
  bgCtx.globalCompositeOperation = 'destination-out';
  bgCtx.fillRect(sel.x, sel.y, sel.w, sel.h);
  bgCtx.restore();
  bgCtx.save();
  bgCtx.globalCompositeOperation = 'destination-over';
  bgCtx.drawImage(bgImg, 0, 0, W, H);
  bgCtx.restore();
  bgCtx.strokeStyle = 'rgba(255,255,255,0.6)';
  bgCtx.lineWidth = 1;
  bgCtx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w - 1, sel.h - 1);
}

function positionToolbar() {
  const TB_W = 52;
  const TB_H = 300;
  const GAP = 10;
  const EDGE = 8;

  let tx = sel.x + sel.w + GAP;
  if (tx + TB_W > W - EDGE) tx = sel.x - TB_W - GAP;
  tx = Math.max(EDGE, Math.min(W - TB_W - EDGE, tx));

  let ty = sel.y;
  if (ty + TB_H > H - EDGE) ty = H - TB_H - EDGE;
  ty = Math.max(EDGE, ty);

  toolbar.style.left = tx + 'px';
  toolbar.style.top = ty + 'px';
}

annCv.addEventListener('mousedown', (e) => {
  if (phase !== 'annotating') return;
  const p = { x: e.clientX, y: e.clientY };
  const lw = tool === 'pen' ? 5 : 3;
  if (tool === 'arrow') draft = { type: 'arrow', a: p, b: { ...p }, color, lw };
  if (tool === 'pen') draft = { type: 'pen', pts: [p], color, lw };
  if (tool === 'rect') draft = { type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color, lw };
});

annCv.addEventListener('mousemove', (e) => {
  if (phase !== 'annotating' || !draft) return;
  const p = { x: e.clientX, y: e.clientY };
  if (draft.type === 'arrow') draft.b = p;
  if (draft.type === 'pen') {
    const last = draft.pts[draft.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) draft.pts.push(p);
  }
  if (draft.type === 'rect') { draft.w = p.x - draft.x; draft.h = p.y - draft.y; }
  paintAnn();
});

function commitDraft() {
  if (!draft) return;
  if (draft.type === 'pen' && draft.pts.length < 2) { draft = null; return; }
  if (draft.type === 'arrow' && Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) < 4) { draft = null; return; }
  if (draft.type === 'rect') {
    const nw = Math.abs(draft.w), nh = Math.abs(draft.h);
    if (nw < 2 || nh < 2) { draft = null; return; }
    draft = { ...draft, x: draft.w < 0 ? draft.x + draft.w : draft.x, y: draft.h < 0 ? draft.y + draft.h : draft.y, w: nw, h: nh };
  }
  strokes.push(draft);
  draft = null;
  paintAnn();
}

function paintAnn() {
  annCtx.clearRect(0, 0, W, H);
  for (const s of strokes) drawStroke(annCtx, s);
  if (draft) drawStroke(annCtx, draft);
}

function drawStroke(ctx, s) {
  ctx.save();
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'arrow') {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    if (Math.hypot(dx, dy) < 1) { ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke();
    const angle = Math.atan2(dy, dx);
    const head = Math.max(12, s.lw * 3.5);
    ctx.beginPath();
    ctx.moveTo(s.b.x, s.b.y);
    ctx.lineTo(s.b.x - head * Math.cos(angle - 0.42), s.b.y - head * Math.sin(angle - 0.42));
    ctx.lineTo(s.b.x - head * Math.cos(angle + 0.42), s.b.y - head * Math.sin(angle + 0.42));
    ctx.closePath(); ctx.fill();
  } else if (s.type === 'pen') {
    if (s.pts.length < 2) { ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(s.pts[0].x, s.pts[0].y);
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
    ctx.stroke();
  } else if (s.type === 'rect') {
    ctx.strokeRect(s.x, s.y, s.w, s.h);
  }
  ctx.restore();
}

async function commit(action) {
  const cw = Math.round(sel.w * scaleX);
  const ch = Math.round(sel.h * scaleY);
  const ox = Math.round(sel.x * scaleX);
  const oy = Math.round(sel.y * scaleY);

  const oc = document.createElement('canvas');
  oc.width = cw;
  oc.height = ch;
  const octx = oc.getContext('2d');

  octx.drawImage(bgImg, ox, oy, cw, ch, 0, 0, cw, ch);

  if (strokes.length > 0) {
    const ac = document.createElement('canvas');
    ac.width = cw; ac.height = ch;
    const actx = ac.getContext('2d');
    actx.scale(scaleX, scaleY);
    actx.translate(-sel.x, -sel.y);
    for (const s of strokes) drawStroke(actx, { ...s, lw: s.lw * scaleX });
    octx.drawImage(ac, 0, 0);
  }

  const dataUrl = oc.toDataURL('image/png');
  await window.api.overlay.done({ dataUrl, action });
}

document.getElementById('btnUndo').addEventListener('click', () => {
  strokes.pop(); paintAnn();
});
document.getElementById('btnCopy').addEventListener('click', () => commit('copy'));
document.getElementById('btnSave').addEventListener('click', () => commit('save'));
document.getElementById('btnCancel').addEventListener('click', () => window.api.overlay.cancel());

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { window.api.overlay.cancel(); return; }
  if (e.key === 'Enter' && phase === 'annotating') { commit('copy'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && phase === 'annotating') {
    e.preventDefault(); strokes.pop(); paintAnn();
  }
});
