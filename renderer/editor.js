const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const colorEl = document.getElementById('color');
const widthEl = document.getElementById('width');
const swatch = document.getElementById('swatch');
const undoBtn = document.getElementById('undo');
const copyBtn = document.getElementById('copy');
const saveBtn = document.getElementById('save');
const toast = document.getElementById('toast');

let tool = 'arrow';
const base = new Image();
let strokes = [];
let draft = null;

// sync swatch
swatch.style.background = colorEl.value;
colorEl.addEventListener('input', () => { swatch.style.background = colorEl.value; });

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), 1500);
}

document.querySelectorAll('.tool[data-tool]').forEach((b) => {
  b.addEventListener('click', () => {
    tool = b.dataset.tool;
    document.querySelectorAll('.tool[data-tool]').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    strokes.pop();
    paint();
  }
});

/* ── Drawing helpers ─────────────────────── */
function pt(e) {
  const r = cv.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (cv.width / r.width),
    y: (e.clientY - r.top) * (cv.height / r.height),
  };
}

function drawArrow(ax, ay, bx, by, color, w) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
  const angle = Math.atan2(by - ay, bx - ax);
  const head = Math.max(10, w * 3);
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx - head * Math.cos(angle - 0.42), by - head * Math.sin(angle - 0.42));
  ctx.lineTo(bx - head * Math.cos(angle + 0.42), by - head * Math.sin(angle + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPen(pts, color, w) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
  ctx.restore();
}

function drawRect(x, y, w, h, color, lw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function normRect(d) {
  return {
    x: d.w < 0 ? d.x + d.w : d.x,
    y: d.h < 0 ? d.y + d.h : d.y,
    w: Math.abs(d.w),
    h: Math.abs(d.h),
  };
}

function paint() {
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(base, 0, 0, cv.width, cv.height);
  for (const s of strokes) renderStroke(s);
  if (draft) renderStroke(draft);
}

function renderStroke(s) {
  if (s.type === 'arrow') drawArrow(s.a.x, s.a.y, s.b.x, s.b.y, s.color, s.width);
  if (s.type === 'pen') drawPen(s.points, s.color, s.width);
  if (s.type === 'rect') {
    const n = normRect(s);
    drawRect(n.x, n.y, n.w, n.h, s.color, s.width);
  }
}

/* ── Mouse ───────────────────────────────── */
cv.addEventListener('mousedown', (e) => {
  const p = pt(e);
  const color = colorEl.value;
  const width = Number(widthEl.value);
  if (tool === 'arrow') draft = { type: 'arrow', a: p, b: p, color, width };
  if (tool === 'pen') draft = { type: 'pen', points: [p], color, width };
  if (tool === 'rect') draft = { type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color, width };
});

cv.addEventListener('mousemove', (e) => {
  if (!draft) return;
  const p = pt(e);
  if (draft.type === 'arrow') draft.b = p;
  if (draft.type === 'pen') {
    const last = draft.points[draft.points.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) draft.points.push(p);
  }
  if (draft.type === 'rect') { draft.w = p.x - draft.x; draft.h = p.y - draft.y; }
  paint();
});

window.addEventListener('mouseup', () => {
  if (!draft) return;
  if (draft.type === 'pen' && draft.points.length < 2) { draft = null; return; }
  if (draft.type === 'rect') {
    const n = normRect(draft);
    if (n.w < 2 || n.h < 2) { draft = null; return; }
    strokes.push({ type: 'rect', x: n.x, y: n.y, w: n.w, h: n.h, color: draft.color, width: draft.width });
    draft = null; paint(); return;
  }
  if (draft.type === 'arrow' && Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) < 4) {
    draft = null; return;
  }
  strokes.push(draft);
  draft = null;
  paint();
});

/* ── Actions ─────────────────────────────── */
undoBtn.addEventListener('click', () => { strokes.pop(); paint(); });

copyBtn.addEventListener('click', async () => {
  await window.api.editor.copyPng(cv.toDataURL('image/png'));
  showToast('Скопировано');
});

saveBtn.addEventListener('click', async () => {
  const res = await window.api.editor.savePng(cv.toDataURL('image/png'));
  if (res?.ok) showToast('Сохранено');
});

/* ── Init ────────────────────────────────── */
(async () => {
  const data = await window.api.editor.getImage();
  if (!data?.dataUrl) return;
  base.onload = () => {
    cv.width = base.naturalWidth;
    cv.height = base.naturalHeight;
    paint();
  };
  base.src = data.dataUrl;
})();
