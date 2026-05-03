const bgCv = document.getElementById('bgCv');
const annCv = document.getElementById('annCv');
const selDiv = document.getElementById('sel');
const toolbar = document.getElementById('toolbar');
const hint = document.getElementById('hint');
const hintAnnot = document.getElementById('hintAnnot');
const handleLayer = document.getElementById('handleLayer');
const selSizeLabel = document.getElementById('selSizeLabel');
const btnLineWidth = document.getElementById('btnLineWidth');
const lwPopover = document.getElementById('lwPopover');
const bgCtx = bgCv.getContext('2d');
const annCtx = annCv.getContext('2d');

const MIN_SEL = 24;
const DEFAULT_PIXEL = 8;
const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MOVE_RING = 11;

let phase = 'idle';
let mode = 'quick';
let W = 0, H = 0;
let scaleX = 1, scaleY = 1;
let bgImg = null;
let sel = null;
let tool = 'arrow';
let color = '#d43535';
let lineWidth = 4;
let strokes = [];
let draft = null;
let dragging = false;
let sx0 = 0, sy0 = 0;

let resizing = false;
let resizeHandle = null;
let resizeStart = null;

let movingSel = false;
let moveStart = null;

function syncColorButtons() {
  document.querySelectorAll('.tbColor').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.color === color);
  });
}

function setColor(hex) {
  color = hex;
  syncColorButtons();
}

document.querySelectorAll('.tbColor').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setColor(btn.dataset.color);
  });
});
syncColorButtons();

function setLineWidth(n) {
  lineWidth = n;
  btnLineWidth.textContent = String(n);
  lwPopover.querySelectorAll('.lwOpt').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.lw) === n);
  });
}

btnLineWidth.addEventListener('click', (e) => {
  e.stopPropagation();
  lwPopover.classList.toggle('open');
});

lwPopover.querySelectorAll('.lwOpt').forEach((b) => {
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    setLineWidth(Number(b.dataset.lw) || 4);
    lwPopover.classList.remove('open');
  });
});

document.addEventListener('click', (ev) => {
  if (!lwPopover.classList.contains('open')) return;
  if (!ev.target.closest('.tbLineWrap')) lwPopover.classList.remove('open');
}, true);

btnLineWidth.addEventListener('mousedown', (e) => e.stopPropagation());
lwPopover.addEventListener('mousedown', (e) => e.stopPropagation());

function initHandles() {
  if (handleLayer.children.length) return;
  for (const h of HANDLE_NAMES) {
    const d = document.createElement('div');
    d.className = 'resizeH';
    d.dataset.h = h;
    handleLayer.appendChild(d);
  }
}

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
  bgCv.style.width = `${W}px`; bgCv.style.height = `${H}px`;
  annCv.width = W; annCv.height = H;
  annCv.style.width = `${W}px`; annCv.style.height = `${H}px`;

  bgImg = new Image();
  await new Promise((res) => { bgImg.onload = res; bgImg.src = data.dataUrl; });

  bgCtx.clearRect(0, 0, W, H);
  bgCtx.drawImage(bgImg, 0, 0, W, H);
  bgCtx.fillStyle = 'rgba(0,0,0,0.46)';
  bgCtx.fillRect(0, 0, W, H);

  annCtx.clearRect(0, 0, W, H);
  strokes = []; draft = null;
  initHandles();
  setLineWidth(4);

  phase = 'selecting';
  selDiv.style.display = 'none';
  toolbar.style.display = 'none';
  handleLayer.style.display = 'none';
  selSizeLabel.style.display = 'none';
  hint.style.display = 'block';
  hintAnnot.style.display = 'none';
  annCv.style.pointerEvents = 'none';
  document.body.style.cursor = 'crosshair';

  window.api.overlay.ready();
}

function fullReset() {
  phase = 'idle';
  sel = null; strokes = []; draft = null;
  resizing = false; resizeHandle = null; resizeStart = null;
  movingSel = false; moveStart = null;
  selDiv.style.display = 'none';
  toolbar.style.display = 'none';
  handleLayer.style.display = 'none';
  selSizeLabel.style.display = 'none';
  lwPopover.classList.remove('open');
  hint.style.display = 'none';
  hintAnnot.style.display = 'none';
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

handleLayer.addEventListener('mousedown', (e) => {
  if (phase !== 'annotating') return;
  const h = e.target.closest('.resizeH')?.dataset?.h;
  if (!h) return;
  e.preventDefault();
  e.stopPropagation();
  resizing = true;
  resizeHandle = h;
  resizeStart = { mx: e.clientX, my: e.clientY, sel: { ...sel } };
});

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function physSize() {
  if (!sel) return { pw: 0, ph: 0 };
  return {
    pw: Math.round(sel.w * scaleX),
    ph: Math.round(sel.h * scaleY),
  };
}

function updateSelLabel() {
  if (!sel || phase !== 'annotating') {
    selSizeLabel.style.display = 'none';
    return;
  }
  const { pw, ph } = physSize();
  selSizeLabel.textContent = `${pw} × ${ph}`;
  selSizeLabel.style.display = 'block';
  requestAnimationFrame(() => {
    if (!sel || phase !== 'annotating') return;
    const pad = 6;
    const lw = selSizeLabel.offsetWidth || 72;
    const lh = 22;
    let lx = sel.x + sel.w - lw - pad;
    let ly = sel.y + sel.h + pad;
    if (lx < 6) lx = sel.x + pad;
    if (ly + lh > H - 4) ly = sel.y - lh - pad;
    selSizeLabel.style.left = `${clamp(lx, 4, W - lw - 4)}px`;
    selSizeLabel.style.top = `${clamp(ly, 4, H - lh - 4)}px`;
  });
}

function insideMoveRing(px, py) {
  if (!sel) return false;
  const { x, y, w, h } = sel;
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const t = MOVE_RING;
  if (w < 2 * t + 16 || h < 2 * t + 16) return true;
  return px <= x + t || px >= x + w - t || py <= y + t || py >= y + h - t;
}

function applyResize(ex, ey) {
  const s0 = resizeStart.sel;
  const dx = ex - resizeStart.mx;
  const dy = ey - resizeStart.my;
  const hn = resizeHandle;
  let x = s0.x;
  let y = s0.y;
  let w = s0.w;
  let hh = s0.h;

  if (hn === 'e' || hn === 'ne' || hn === 'se') {
    w = clamp(s0.w + dx, MIN_SEL, W - s0.x);
  }
  if (hn === 's' || hn === 'se' || hn === 'sw') {
    hh = clamp(s0.h + dy, MIN_SEL, H - s0.y);
  }
  if (hn === 'w' || hn === 'nw' || hn === 'sw') {
    const nw = clamp(s0.w - dx, MIN_SEL, s0.x + s0.w);
    x = s0.x + s0.w - nw;
    w = nw;
    if (x < 0) {
      w += x;
      x = 0;
      w = Math.max(MIN_SEL, w);
    }
  }
  if (hn === 'n' || hn === 'nw' || hn === 'ne') {
    const nh = clamp(s0.h - dy, MIN_SEL, s0.y + s0.h);
    y = s0.y + s0.h - nh;
    hh = nh;
    if (y < 0) {
      hh += y;
      y = 0;
      hh = Math.max(MIN_SEL, hh);
    }
  }

  if (x + w > W) w = Math.max(MIN_SEL, W - x);
  if (y + hh > H) hh = Math.max(MIN_SEL, H - y);
  sel = { x, y, w, h: hh };
}

function layoutHandles() {
  if (!sel || phase !== 'annotating') {
    handleLayer.style.display = 'none';
    return;
  }
  handleLayer.style.display = 'block';
  const { x, y, w, h } = sel;
  const map = {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y],
    e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h],
    sw: [x, y + h], w: [x, y + h / 2],
  };
  handleLayer.querySelectorAll('.resizeH').forEach((el) => {
    const [cx, cy] = map[el.dataset.h];
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
  });
}

function positionToolbar() {
  toolbar.style.display = 'flex';
  toolbar.style.left = '0px';
  toolbar.style.top = '0px';
  void toolbar.offsetWidth;
  const TB_W = toolbar.offsetWidth || 320;
  const TB_H = toolbar.offsetHeight || 44;
  const GAP = 8;
  const EDGE = 6;
  const sx = sel.x, sy = sel.y, sw = sel.w, sh = sel.h;

  const candidates = [
    { x: sx + (sw - TB_W) / 2, y: sy + sh + GAP },
    { x: sx + (sw - TB_W) / 2, y: sy - TB_H - GAP },
    { x: sx + sw + GAP, y: sy + (sh - TB_H) / 2 },
    { x: sx - TB_W - GAP, y: sy + (sh - TB_H) / 2 },
    { x: sx + (sw - TB_W) / 2, y: Math.max(EDGE, sy + (sh - TB_H) / 2) },
    { x: W - TB_W - EDGE, y: H - TB_H - EDGE },
    { x: EDGE, y: H - TB_H - EDGE },
    { x: EDGE, y: EDGE },
    { x: W - TB_W - EDGE, y: EDGE },
  ];

  function fits(cx, cy) {
    return cx >= EDGE && cy >= EDGE && cx + TB_W <= W - EDGE && cy + TB_H <= H - EDGE;
  }

  let best = { x: clamp(sx + sw / 2 - TB_W / 2, EDGE, W - TB_W - EDGE), y: H - TB_H - EDGE };
  for (const c of candidates) {
    if (fits(c.x, c.y)) {
      best = c;
      break;
    }
  }
  if (!fits(best.x, best.y)) {
    best.x = clamp(sx + sw / 2 - TB_W / 2, EDGE, W - TB_W - EDGE);
    best.y = clamp(sy + sh / 2 - TB_H / 2, EDGE, H - TB_H - EDGE);
  }

  toolbar.style.left = `${best.x}px`;
  toolbar.style.top = `${best.y}px`;
}

bgCv.addEventListener('mousedown', (e) => {
  if (phase !== 'selecting') return;
  dragging = true;
  sx0 = e.clientX; sy0 = e.clientY;
  selDiv.style.display = 'none';
  document.body.style.cursor = 'crosshair';
});

window.addEventListener('mousemove', (e) => {
  if (resizing && resizeStart) {
    applyResize(e.clientX, e.clientY);
    redrawBg();
    layoutHandles();
    updateSelLabel();
    positionToolbar();
    paintAnn();
    return;
  }
  if (movingSel && moveStart) {
    const dx = e.clientX - moveStart.mx;
    const dy = e.clientY - moveStart.my;
    const s0 = moveStart.sel;
    sel = {
      x: clamp(s0.x + dx, 0, W - s0.w),
      y: clamp(s0.y + dy, 0, H - s0.h),
      w: s0.w,
      h: s0.h,
    };
    redrawBg();
    layoutHandles();
    updateSelLabel();
    positionToolbar();
    paintAnn();
    return;
  }
  if (phase !== 'selecting' || !dragging) return;
  const x = Math.min(sx0, e.clientX);
  const y = Math.min(sy0, e.clientY);
  const w = Math.abs(e.clientX - sx0);
  const h = Math.abs(e.clientY - sy0);
  selDiv.style.left = `${x}px`;
  selDiv.style.top = `${y}px`;
  selDiv.style.width = `${w}px`;
  selDiv.style.height = `${h}px`;
  if (w > 2 && h > 2) selDiv.style.display = 'block';
});

window.addEventListener('mouseup', async (e) => {
  if (resizing) {
    resizing = false;
    resizeHandle = null;
    resizeStart = null;
    return;
  }
  if (movingSel) {
    movingSel = false;
    moveStart = null;
    return;
  }
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
  hintAnnot.style.display = 'block';

  redrawBg();
  layoutHandles();
  updateSelLabel();
  positionToolbar();
  toolbar.style.display = 'flex';
  positionToolbar();
  updateSelLabel();
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
  bgCtx.strokeStyle = 'rgba(255,255,255,0.65)';
  bgCtx.lineWidth = 1;
  bgCtx.strokeRect(sel.x + 0.5, sel.y + 0.5, sel.w - 1, sel.h - 1);
}

annCv.addEventListener('mousedown', (e) => {
  if (phase !== 'annotating') return;
  const px = e.clientX;
  const py = e.clientY;
  if (insideMoveRing(px, py)) {
    movingSel = true;
    moveStart = { mx: px, my: py, sel: { ...sel } };
    e.preventDefault();
    return;
  }
  const p = { x: px, y: py };
  const lw = lineWidth;
  if (tool === 'arrow') draft = { type: 'arrow', a: p, b: { ...p }, color, lw };
  if (tool === 'pen') draft = { type: 'pen', pts: [p], color, lw };
  if (tool === 'rect') draft = { type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color, lw };
  if (tool === 'blur') draft = { type: 'blur', x: p.x, y: p.y, w: 0, h: 0, pixelSize: DEFAULT_PIXEL };
});

annCv.addEventListener('mousemove', (e) => {
  if (phase === 'annotating' && draft) {
    annCv.style.cursor = 'crosshair';
  } else if (phase === 'annotating' && !movingSel && !resizing) {
    annCv.style.cursor = insideMoveRing(e.clientX, e.clientY) ? 'grab' : 'crosshair';
  }
  if (phase !== 'annotating' || !draft) return;
  const p = { x: e.clientX, y: e.clientY };
  if (draft.type === 'arrow') draft.b = p;
  if (draft.type === 'pen') {
    const last = draft.pts[draft.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5) draft.pts.push(p);
  }
  if (draft.type === 'rect' || draft.type === 'blur') {
    draft.w = p.x - draft.x;
    draft.h = p.y - draft.y;
  }
  paintAnn();
});

function commitDraft() {
  if (!draft) return;
  if (draft.type === 'pen' && draft.pts.length < 2) { draft = null; return; }
  if (draft.type === 'arrow' && Math.hypot(draft.b.x - draft.a.x, draft.b.y - draft.a.y) < 4) { draft = null; return; }
  if (draft.type === 'rect' || draft.type === 'blur') {
    const nw = Math.abs(draft.w), nh = Math.abs(draft.h);
    if (nw < 4 || nh < 4) { draft = null; return; }
    draft = {
      ...draft,
      x: draft.w < 0 ? draft.x + draft.w : draft.x,
      y: draft.h < 0 ? draft.y + draft.h : draft.y,
      w: nw,
      h: nh,
    };
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

function drawStraightArrow(ctx, a, b, lw, strokeCol) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;

  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const headLen = Math.max(12, lw * 4.0);
  const spread = 0.28;
  const inset = headLen * Math.cos(spread) - 0.45 * lw;
  const trim = clamp(inset, lw * 0.35, len - lw * 0.12);
  const pEnd = {
    x: b.x - trim * cos,
    y: b.y - trim * sin,
  };

  ctx.strokeStyle = strokeCol;
  ctx.fillStyle = strokeCol;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';

  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(pEnd.x, pEnd.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(a.x, a.y, lw * 0.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(
    b.x - headLen * Math.cos(angle - spread),
    b.y - headLen * Math.sin(angle - spread),
  );
  ctx.lineTo(
    b.x - headLen * Math.cos(angle + spread),
    b.y - headLen * Math.sin(angle + spread),
  );
  ctx.closePath();
  ctx.fill();
}

function drawPixelBlur(ctx, bx, by, bw, bh, pixelSize) {
  if (!bgImg || !bgImg.naturalWidth) return;
  const ps = Math.max(2, Math.min(40, pixelSize || DEFAULT_PIXEL));
  const bx0 = Math.round(bx);
  const by0 = Math.round(by);
  const bw0 = Math.max(1, Math.floor(bw));
  const bh0 = Math.max(1, Math.floor(bh));
  const nw = bgImg.naturalWidth;
  const nh = bgImg.naturalHeight;

  const ix0 = clamp(Math.floor(bx0 * scaleX), 0, Math.max(0, nw - 1));
  const iy0 = clamp(Math.floor(by0 * scaleY), 0, Math.max(0, nh - 1));
  const ix1 = clamp(Math.ceil((bx0 + bw0) * scaleX), ix0 + 1, nw);
  const iy1 = clamp(Math.ceil((by0 + bh0) * scaleY), iy0 + 1, nh);
  const wr = ix1 - ix0;
  const hr = iy1 - iy0;

  const cellW = Math.max(1, Math.round(ps * scaleX));
  const cellH = Math.max(1, Math.round(ps * scaleY));
  const tilesX = Math.max(1, Math.ceil(wr / cellW));
  const tilesY = Math.max(1, Math.ceil(hr / cellH));

  const srcCv = document.createElement('canvas');
  srcCv.width = wr;
  srcCv.height = hr;
  const sctx = srcCv.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bgImg, ix0, iy0, wr, hr, 0, 0, wr, hr);
  const src = sctx.getImageData(0, 0, wr, hr);
  const d = src.data;

  const outCv = document.createElement('canvas');
  outCv.width = tilesX;
  outCv.height = tilesY;
  const octx = outCv.getContext('2d');
  const out = octx.createImageData(tilesX, tilesY);
  const o = out.data;

  for (let ty = 0; ty < tilesY; ty++) {
    const y0 = ty * cellH;
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * cellW;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      const ymax = Math.min(cellH, hr - y0);
      const xmax = Math.min(cellW, wr - x0);
      for (let yy = 0; yy < ymax; yy++) {
        const row = (y0 + yy) * wr + x0;
        for (let xx = 0; xx < xmax; xx++) {
          const i = (row + xx) * 4;
          r += d[i];
          g += d[i + 1];
          b += d[i + 2];
          a += d[i + 3];
          n++;
        }
      }
      const j = (ty * tilesX + tx) * 4;
      if (n > 0) {
        o[j] = (r / n) | 0;
        o[j + 1] = (g / n) | 0;
        o[j + 2] = (b / n) | 0;
        o[j + 3] = Math.round(a / n) || 255;
      }
    }
  }
  octx.putImageData(out, 0, 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(bx0, by0, bw0, bh0);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(outCv, 0, 0, tilesX, tilesY, bx0, by0, bw0, bh0);
  ctx.restore();
}

function drawStroke(ctx, s) {
  ctx.save();
  if (s.type === 'blur') {
    const bx = s.w < 0 ? s.x + s.w : s.x;
    const by = s.h < 0 ? s.y + s.h : s.y;
    const bw = Math.abs(s.w);
    const bh = Math.abs(s.h);
    if (bw < 6 || bh < 6) {
      ctx.strokeStyle = 'rgba(230,230,245,0.65)';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(bx + 0.5, by + 0.5, Math.max(0, bw - 1), Math.max(0, bh - 1));
      ctx.restore();
      return;
    }
    drawPixelBlur(ctx, bx, by, bw, bh, s.pixelSize);
    ctx.restore();
    return;
  }
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.type === 'arrow') {
    drawStraightArrow(ctx, s.a, s.b, s.lw, s.color);
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
    const rs = Math.max(scaleX, scaleY, 1);
    for (const s of strokes) {
      if (s.type === 'blur') {
        const ps = (s.pixelSize || DEFAULT_PIXEL) * rs;
        drawStroke(actx, { ...s, pixelSize: ps });
      } else {
        drawStroke(actx, { ...s, lw: s.lw * scaleX });
      }
    }
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
  if (e.key === 'Escape') {
    if (lwPopover.classList.contains('open')) {
      lwPopover.classList.remove('open');
      e.preventDefault();
      return;
    }
    window.api.overlay.cancel();
    return;
  }
  if (e.key === 'Enter' && phase === 'annotating') { commit('copy'); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && phase === 'annotating') {
    e.preventDefault(); strokes.pop(); paintAnn();
  }
});
