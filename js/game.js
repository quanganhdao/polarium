// Polarium (GBA) clone — vanilla JS + Canvas 2D + Web Audio.
(() => {
  'use strict';

  // ---- Màn hình ảo, vẽ ở độ nét x4 ----
  // Ngang: 240x160 (độ phân giải GBA). Dọc (điện thoại): 180x320.
  const SCALE = 4;
  let W = 240, H = 160, PORTRAIT = false, LAY = null;
  const cv = document.getElementById('screen');
  const ctx = cv.getContext('2d');
  const FONT = '"VT323", ui-monospace, monospace';

  const C = {
    bg: '#1b1d3a', bg2: '#23264c', panel: '#111329', panelLine: '#2e3266',
    black: '#1c1c28', blackHi: '#3b3b52', white: '#f4f1e6', whiteSh: '#bdb8a6',
    frame: '#56629a', frameHi: '#7482c0', frameDot: '#46508a',
    line: '#ff3b5c', lineEdge: '#7a0f24', head: '#ffd23f',
    text: '#f4f1e6', accent: '#ffd23f', dim: '#8a8fb8', good: '#5fe3a1', bad: '#ff6b7f',
  };

  function applyLayout() {
    const vw = window.innerWidth, vh = window.innerHeight;
    PORTRAIT = vh > vw * 1.05;
    document.body.classList.toggle('portrait', PORTRAIT);
    // chừa chỗ cho hàng nút / chữ hướng dẫn bên dưới
    const below = [...document.querySelectorAll('.below')].reduce((a, e) => a + e.offsetHeight, 0);
    const availW = PORTRAIT ? vw - 16 : Math.min(vw - 90, 960);
    const availH = vh - below - (PORTRAIT ? 28 : 110);
    let nw, nh;
    if (PORTRAIT) {
      // chiều cao ảo co giãn theo tỉ lệ máy để lấp kín màn hình dọc
      nw = 180; nh = Math.max(300, Math.min(400, Math.round(180 * availH / availW)));
      LAY = { grid: { x: 4, y: 32, w: 172, h: nh - 86 }, bottom: nh - 50 };
    } else {
      nw = 240; nh = 160;
      LAY = { grid: { x: 84, y: 2, w: 156, h: 156 } };
    }
    if (nw !== W || nh !== H || !cv.width || cv.width !== nw * SCALE) {
      W = nw; H = nh;
      cv.width = W * SCALE; cv.height = H * SCALE;
    }
    if (P) layoutBoard();
    const s = Math.max(0.8, Math.min(availW / W, availH / H));
    cv.style.width = Math.floor(W * s) + 'px';
    cv.style.height = Math.floor(H * s) + 'px';
  }
  window.addEventListener('resize', () => applyLayout());
  window.addEventListener('orientationchange', () => setTimeout(applyLayout, 100));

  // ---- Âm thanh kiểu chip GBA ----
  let actx = null, muted = false;
  function beep(freq, dur = 0.05, type = 'square', vol = 0.05, delay = 0, slide = 0) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    } catch (e) { /* không có âm thanh cũng không sao */ }
  }
  const sfx = {
    move: () => beep(520, 0.025, 'square', 0.025),
    step: () => beep(700, 0.03, 'square', 0.035),
    back: () => beep(420, 0.03, 'square', 0.03),
    bump: () => beep(110, 0.08, 'sawtooth', 0.04),
    start: () => beep(880, 0.05, 'square', 0.04, 0, 200),
    flip: (i) => beep(400 + (i % 12) * 45, 0.03, 'triangle', 0.06),
    select: () => { beep(660, 0.05); beep(990, 0.07, 'square', 0.05, 0.05); },
    cancel: () => beep(300, 0.08, 'square', 0.04, 0, -120),
    miss: () => { beep(330, 0.12, 'square', 0.05); beep(220, 0.25, 'square', 0.05, 0.12); },
    clear: () => [523, 659, 784, 1047].forEach((f, i) => beep(f, 0.12, 'square', 0.05, i * 0.08)),
    win: () => [784, 988, 1175, 1568, 1175, 1568].forEach((f, i) => beep(f, 0.14, 'square', 0.045, i * 0.1)),
  };

  // ---- Lưu tiến trình ----
  const SAVE_KEY = 'polarium-js-save';
  let save = { cleared: [], best: {} };
  try { save = Object.assign(save, JSON.parse(localStorage.getItem(SAVE_KEY)) || {}); } catch (e) {}
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

  // ---- Trạng thái ----
  const state = { screen: 'title', t: 0, sel: 0, endT: 0, keys: false }; // keys: đang chơi bằng phím
  let P = null; // trạng thái màn đang chơi

  const FLIP_STEP = 0.055, FLIP_ANIM = 0.18;
  const key = (x, y) => x + ',' + y;

  function loadLevel(i) {
    const L = LEVELS[i];
    const h = L.rows.length, w = L.rows[0].length;
    P = { i, L, w, h, cursor: { x: 0, y: 0 }, tries: 0, showHint: false, mouseDraw: false };
    layoutBoard();
    resetBoard();
    state.screen = 'play';
    if (!seenHelp()) openHelp();
  }

  function layoutBoard() {
    const g = LAY.grid, n = Math.max(P.w, P.h) + 2;
    P.cs = Math.min(PORTRAIT ? 26 : 20, Math.floor(Math.min(g.w, g.h) / n));
    P.gx = g.x + Math.floor((g.w - (P.w + 2) * P.cs) / 2);
    P.gy = g.y + Math.floor((g.h - (P.h + 2) * P.cs) / 2);
  }

  function resetBoard() {
    P.board = P.L.rows.map(r => [...r].map(c => (c === '#' ? 1 : 0)));
    P.flipAt = P.board.map(r => r.map(() => -1));
    P.path = []; P.visited = new Set();
    P.phase = 'idle'; P.timer = 0; P.flipIdx = 0; P.rowsHit = [];
    P.mouseDraw = false; P.msg = '';
  }

  const inExt = (x, y) => x >= -1 && x <= P.w && y >= -1 && y <= P.h;
  const isIn = (x, y) => x >= 0 && x < P.w && y >= 0 && y < P.h;

  // ---- Vẽ nét ----
  function beginPath(x, y) {
    if (!inExt(x, y)) return false;
    P.path = [{ x, y }]; P.visited = new Set([key(x, y)]);
    P.phase = 'draw'; P.cursor = { x, y };
    sfx.start();
    return true;
  }

  function tryStep(nx, ny) {
    if (!inExt(nx, ny)) { sfx.bump(); return false; }
    const last = P.path[P.path.length - 1];
    if (Math.abs(nx - last.x) + Math.abs(ny - last.y) !== 1) return false;
    const prev = P.path[P.path.length - 2];
    if (prev && prev.x === nx && prev.y === ny) {   // lùi lại = xóa bước cuối
      P.visited.delete(key(last.x, last.y)); P.path.pop();
      P.cursor = { x: nx, y: ny }; sfx.back();
      return true;
    }
    if (P.visited.has(key(nx, ny))) { sfx.bump(); return false; } // không được tự cắt
    P.path.push({ x: nx, y: ny }); P.visited.add(key(nx, ny));
    P.cursor = { x: nx, y: ny }; sfx.step();
    return true;
  }

  // Kéo chuột nhanh có thể nhảy nhiều ô — đi từng bước về phía ô đích.
  function dragTo(tx, ty) {
    for (let guard = 0; guard < 40; guard++) {
      const last = P.path[P.path.length - 1];
      const dx = tx - last.x, dy = ty - last.y;
      if (!dx && !dy) return;
      const first = Math.abs(dx) >= Math.abs(dy)
        ? [last.x + Math.sign(dx), last.y] : [last.x, last.y + Math.sign(dy)];
      const second = Math.abs(dx) >= Math.abs(dy)
        ? (dy ? [last.x, last.y + Math.sign(dy)] : null) : (dx ? [last.x + Math.sign(dx), last.y] : null);
      if (tryStepQuiet(first) || (second && tryStepQuiet(second))) continue;
      return;
    }
  }
  function tryStepQuiet([x, y]) {
    if (!inExt(x, y)) return false;
    const prev = P.path[P.path.length - 2];
    if (P.visited.has(key(x, y)) && !(prev && prev.x === x && prev.y === y)) return false;
    return tryStep(x, y);
  }

  function cancelPath() {
    P.path = []; P.visited = new Set(); P.phase = 'idle'; P.mouseDraw = false;
    sfx.cancel();
  }

  function commit() {
    P.mouseDraw = false;
    if (!P.path.some(p => isIn(p.x, p.y))) { cancelPath(); return; }
    P.tries++;
    P.phase = 'flip'; P.flipIdx = 0; P.timer = 0;
  }

  function evaluate() {
    const uniform = [];
    for (let y = 0; y < P.h; y++) {
      const r = P.board[y];
      if (r.every(v => v === r[0])) uniform.push(y);
    }
    P.rowsHit = uniform; P.timer = 0;
    if (uniform.length === P.h) {
      P.phase = 'clear'; sfx.clear();
    } else {
      P.phase = 'fail'; sfx.miss();
      P.msg = `Còn ${P.h - uniform.length} hàng lẫn cả đen lẫn trắng (chấm đỏ)`;
    }
  }

  function winLevel() {
    P.phase = 'win'; P.timer = 0; sfx.win();
    if (!save.cleared.includes(P.i)) save.cleared.push(P.i);
    const b = save.best[P.i];
    if (!b || P.tries < b) save.best[P.i] = P.tries;
    persist();
  }

  // Lời giải: bật/tắt đường gợi ý mờ trên bảng, người chơi tự vẽ theo.
  function toggleHint() {
    if (!P || P.phase === 'win' || P.phase === 'clear') return;
    P.showHint = !P.showHint;
    P.showHint ? sfx.select() : sfx.cancel();
  }

  function nextLevel() {
    if (P.i + 1 < LEVELS.length) { loadLevel(P.i + 1); sfx.select(); }
    else { state.screen = 'ending'; state.endT = 0; sfx.win(); }
  }

  function toSelect() { state.screen = 'select'; if (P) state.sel = P.i; P = null; }

  // ---- Cập nhật ----
  function update(dt) {
    state.t += dt;
    if (state.screen === 'ending') state.endT += dt;
    if (state.screen !== 'play') return;
    P.timer += dt;
    switch (P.phase) {
      case 'flip':
        while (P.timer >= FLIP_STEP && P.flipIdx < P.path.length) {
          P.timer -= FLIP_STEP;
          const { x, y } = P.path[P.flipIdx];
          if (isIn(x, y)) {
            P.board[y][x] ^= 1; P.flipAt[y][x] = state.t; sfx.flip(P.flipIdx);
          }
          P.flipIdx++;
        }
        if (P.flipIdx >= P.path.length && P.timer >= 0.3) evaluate();
        break;
      case 'clear':
        if (P.timer >= 1.1) winLevel();
        break;
      case 'fail':
        if (P.timer >= 2.4) { const t = P.tries; resetBoard(); P.tries = t; }
        break;
    }
  }

  // ---- Vẽ ----
  function text(s, x, y, size = 16, color = C.text, align = 'left', shadow = true) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align; ctx.textBaseline = 'top';
    if (shadow) { ctx.fillStyle = '#0008'; ctx.fillText(s, x + 1, y + 1); }
    ctx.fillStyle = color; ctx.fillText(s, x, y);
  }
  function wrap(s, maxW, size) {
    ctx.font = `${size}px ${FONT}`;
    const words = s.split(' '), lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function drawTile(sx, sy, cs, v, sxScale = 1, syScale = 1) {
    const iw = (cs - 1) * sxScale, ih = (cs - 1) * syScale;
    const x = sx + (cs - 1 - iw) / 2, y = sy + (cs - 1 - ih) / 2;
    if (iw <= 0.2 || ih <= 0.2) return;
    if (v) {
      ctx.fillStyle = C.black; ctx.fillRect(x, y, iw, ih);
      ctx.fillStyle = C.blackHi; ctx.fillRect(x, y, iw, 1); ctx.fillRect(x, y, 1, ih);
    } else {
      ctx.fillStyle = C.white; ctx.fillRect(x, y, iw, ih);
      ctx.fillStyle = C.whiteSh; ctx.fillRect(x, y + ih - 1, iw, 1); ctx.fillRect(x + iw - 1, y, 1, ih);
    }
  }

  function drawBackdrop() {
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    // lưới chéo trôi nhẹ
    ctx.fillStyle = C.bg2;
    const off = (state.t * 6) % 16;
    for (let y = -16; y < H + 16; y += 16)
      for (let x = -16; x < W + 16; x += 16)
        if (((x + y) / 16) % 2 === 0) ctx.fillRect(x + off, y + off, 16, 16);
  }

  function drawBoard() {
    const { cs, gx, gy, w, h } = P;
    // khung viền
    ctx.fillStyle = '#0006'; ctx.fillRect(gx + 2, gy + 2, (w + 2) * cs, (h + 2) * cs);
    ctx.fillStyle = C.frame; ctx.fillRect(gx, gy, (w + 2) * cs, (h + 2) * cs);
    for (let y = -1; y <= h; y++)
      for (let x = -1; x <= w; x++) {
        if (isIn(x, y)) continue;
        const sx = gx + (x + 1) * cs, sy = gy + (y + 1) * cs;
        ctx.fillStyle = C.frameDot; ctx.fillRect(sx + cs / 2 - 1, sy + cs / 2 - 1, 2, 2);
      }
    ctx.strokeStyle = C.frameHi; ctx.lineWidth = 1;
    ctx.strokeRect(gx + 0.5, gy + 0.5, (w + 2) * cs - 1, (h + 2) * cs - 1);
    ctx.fillStyle = '#0a0b18';
    ctx.fillRect(gx + cs - 1, gy + cs - 1, w * cs + 1, h * cs + 1);

    // các ô
    const clearing = P.phase === 'clear' || P.phase === 'win' || P.phase === 'fail';
    for (let y = 0; y < h; y++) {
      const hit = clearing && P.rowsHit.includes(y);
      let syScale = 1, flash = false;
      if (hit) {
        if (P.phase === 'fail') flash = Math.floor(P.timer * 10) % 2 === 0 && P.timer < 1.2;
        else if (P.phase === 'clear') {
          flash = P.timer < 0.5 && Math.floor(P.timer * 12) % 2 === 0;
          if (P.timer >= 0.5) syScale = Math.max(0, 1 - (P.timer - 0.5) / 0.4);
        } else syScale = 0;
      }
      for (let x = 0; x < w; x++) {
        const sx = gx + (x + 1) * cs, sy = gy + (y + 1) * cs;
        let v = P.board[y][x], sxScale = 1;
        const age = state.t - P.flipAt[y][x];
        if (P.flipAt[y][x] >= 0 && age < FLIP_ANIM) {
          const p = age / FLIP_ANIM;
          sxScale = Math.abs(Math.cos(p * Math.PI));
          if (p < 0.5) v ^= 1;
        }
        if (flash) {
          ctx.fillStyle = P.phase === 'fail' ? C.accent : '#ffffff';
          ctx.fillRect(sx, sy, cs - 1, cs - 1);
        } else drawTile(sx, sy, cs, v, sxScale, syScale);
      }
      // đánh dấu hàng đạt / chưa đạt khi thất bại
      if (P.phase === 'fail' && P.timer > 0.2) {
        const ok = P.rowsHit.includes(y);
        const mx = gx + (w + 1) * cs + cs / 2, my = gy + (y + 1) * cs + cs / 2;
        ctx.fillStyle = ok ? C.good : C.bad;
        ctx.beginPath(); ctx.arc(mx, my, Math.max(2, cs * 0.18), 0, Math.PI * 2); ctx.fill();
      }
    }

    // đường gợi ý (Lời giải): nét vàng mờ, chấm tròn ở điểm bắt đầu
    if (P.showHint && ['idle', 'draw', 'fail'].includes(P.phase)) {
      const pts = P.L.solution.map(([x, y]) => [gx + (x + 1.5) * cs, gy + (y + 1.5) * cs]);
      const pulse = 0.45 + 0.2 * Math.sin(state.t * 4);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = C.accent; ctx.lineWidth = Math.max(2, cs * 0.22);
      ctx.setLineDash([cs * 0.3, cs * 0.25]);
      ctx.lineDashOffset = -state.t * cs; // chạy theo hướng vẽ
      ctx.beginPath(); ctx.moveTo(...pts[0]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(...pts[0], cs * (0.32 + 0.06 * Math.sin(state.t * 6)), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    // nét vẽ
    if (P.path.length && ['draw', 'flip'].includes(P.phase)) {
      const pts = P.path.map(p => [gx + (p.x + 1.5) * cs, gy + (p.y + 1.5) * cs]);
      const lw = Math.max(3, cs * 0.34);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const drawLine = (from, color, width) => {
        if (pts.length - from < 1) return;
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.moveTo(...pts[from]);
        for (let i = from + 1; i < pts.length; i++) ctx.lineTo(...pts[i]);
        if (pts.length - from === 1) ctx.lineTo(pts[from][0] + 0.01, pts[from][1]);
        ctx.stroke();
      };
      const from = P.phase === 'flip' ? Math.max(0, P.flipIdx - 1) : 0;
      ctx.globalAlpha = 0.9;
      drawLine(from, C.lineEdge, lw + 2);
      drawLine(from, C.line, lw);
      ctx.globalAlpha = 1;
      if (from === 0) { // điểm bắt đầu
        ctx.fillStyle = C.line;
        ctx.beginPath(); ctx.arc(...pts[0], lw * 0.8, 0, Math.PI * 2); ctx.fill();
      }
      if (P.phase !== 'flip') { // đầu bút
        const [hx, hy] = pts[pts.length - 1];
        const pulse = 0.75 + 0.25 * Math.sin(state.t * 12);
        ctx.fillStyle = C.head;
        ctx.beginPath(); ctx.arc(hx, hy, lw * 0.6 * pulse + 1, 0, Math.PI * 2); ctx.fill();
      }
    }

    // con trỏ bàn phím: chỉ hiện khi đang chơi bằng phím mũi tên
    if (state.keys && P.phase === 'idle') {
      const sx = gx + (P.cursor.x + 1) * cs, sy = gy + (P.cursor.y + 1) * cs;
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 0.5, sy + 0.5, cs - 2, cs - 2);
    }
  }

  // Chữ ngắn, chỉ hiện khi cần
  function phaseMessage() {
    switch (P.phase) {
      case 'idle': return [P.L.hint || '', C.dim];
      case 'draw': return [PORTRAIT ? 'Nhấc tay để lật' : 'Thả / Z để lật', C.text];
      case 'clear': return ['TUYỆT!', C.good];
      case 'fail': return ['TRƯỢT!', C.bad];
    }
    return ['', C.dim];
  }

  // Minh họa luật bằng hình: toàn đen ✓, toàn trắng ✓, lẫn màu ✗
  function drawRuleExamples(x, y, t, gap = 42) {
    const ex = [[1, 1, 1, 1, true], [0, 0, 0, 0, true], [1, 0, 1, 1, false]];
    ex.forEach((e, k) => {
      const ox = x + k * gap;
      for (let i = 0; i < 4; i++) drawTile(ox + i * t, y, t, e[i]);
      const ok = e[4];
      ctx.fillStyle = ok ? C.good : C.bad;
      ctx.beginPath(); ctx.arc(ox + 4 * t + 5, y + t / 2 - 0.5, 4, 0, Math.PI * 2); ctx.fill();
      text(ok ? '✓' : '✗', ox + 4 * t + 5, y + t / 2 - 6, 11, C.panel, 'center', false);
    });
  }

  function drawPanel() {
    if (PORTRAIT) return drawPanelPortrait();
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, 82, H);
    ctx.fillStyle = C.panelLine; ctx.fillRect(82, 0, 2, H);
    text(`Level ${P.i + 1}`, 41, 8, 22, C.accent, 'center');
    const [msg, color] = phaseMessage();
    let y = 40;
    for (const l of wrap(msg, 72, 15).slice(0, 3)) { text(l, 41, y, 15, color, 'center'); y += 12; }
    // luật bằng hình, xếp dọc
    [[1, 1, 1, 1, true], [0, 0, 0, 0, true], [1, 0, 1, 1, false]].forEach((e, k) => {
      const ox = 22, oy = H - 38 + k * 11;
      for (let i = 0; i < 4; i++) drawTile(ox + i * 8, oy, 8, e[i]);
      ctx.fillStyle = e[4] ? C.good : C.bad;
      ctx.beginPath(); ctx.arc(ox + 38, oy + 3.5, 3.5, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawPanelPortrait() {
    // thanh trên: chỉ ghi Level
    ctx.fillStyle = C.panel; ctx.fillRect(0, 0, W, 28);
    ctx.fillStyle = C.panelLine; ctx.fillRect(0, 28, W, 2);
    text(`Level ${P.i + 1}`, W / 2, 3, 24, C.accent, 'center');

    // khung dưới: 1 dòng trạng thái + luật bằng hình
    const y0 = LAY.bottom;
    ctx.fillStyle = C.panel; ctx.fillRect(0, y0, W, H - y0);
    ctx.fillStyle = C.panelLine; ctx.fillRect(0, y0, W, 2);
    const [msg, color] = phaseMessage();
    if (msg) text(msg, W / 2, y0 + 6, 17, color, 'center');
    drawRuleExamples(W / 2 - 62, H - 16, 7);
  }

  function drawWinOverlay() {
    if (P.phase !== 'win') return;
    const g = LAY.grid;
    const a = Math.min(1, P.timer / 0.3);
    const cx = g.x + g.w / 2, cy = g.y + g.h / 2;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#000a'; ctx.fillRect(g.x, cy - 28, g.w, 56);
    ctx.fillStyle = C.accent; ctx.fillRect(g.x, cy - 28, g.w, 1); ctx.fillRect(g.x, cy + 27, g.w, 1);
    const bounce = Math.sin(Math.min(1, P.timer * 3) * Math.PI) * -4;
    text('HOÀN THÀNH!', cx, cy - 22 + bounce, 24, C.accent, 'center');
    const last = P.i + 1 >= LEVELS.length;
    if (Math.floor(state.t * 2.5) % 2 === 0)
      text(last ? 'Chạm để kết thúc' : 'Chạm để tiếp', cx, cy + 6, 14, C.text, 'center');
    ctx.globalAlpha = 1;
  }

  // Màn tiêu đề
  const TT_COLS = 15, TT_ROWS = 26;
  const titleTiles = Array.from({ length: TT_COLS * TT_ROWS }, (_, i) => ({ v: Math.random() < 0.4 ? 1 : 0, next: Math.random() * 6 }));
  function drawTitle() {
    const cs = 16;
    for (let i = 0; i < titleTiles.length; i++) {
      const t = titleTiles[i];
      const x = (i % TT_COLS) * cs, y = Math.floor(i / TT_COLS) * cs;
      if (x >= W || y >= H) continue;
      if (state.t > t.next) { t.v ^= 1; t.next = state.t + 2 + Math.random() * 6; t.at = state.t; }
      let v = t.v, s = 1;
      if (t.at && state.t - t.at < 0.25) { const p = (state.t - t.at) / 0.25; s = Math.abs(Math.cos(p * Math.PI)); if (p < 0.5) v ^= 1; }
      drawTile(x, y, cs, v, s);
    }
    const by = Math.round(H / 2 - 42);
    ctx.fillStyle = '#0b0c1ccc'; ctx.fillRect(0, by, W, 84);
    ctx.fillStyle = C.accent; ctx.fillRect(0, by, W, 1); ctx.fillRect(0, by + 83, W, 1);
    const wob = Math.sin(state.t * 2) * 2;
    text('POLARIUM', W / 2, by + 6 + wob, 40, C.text, 'center');
    text('ADVANCE · bản JS', W / 2, by + 42, 16, C.accent, 'center');
    if (Math.floor(state.t * 2) % 2 === 0)
      text(PORTRAIT ? 'CHẠM ĐỂ BẮT ĐẦU' : 'NHẤN Z / CHẠM ĐỂ BẮT ĐẦU', W / 2, by + 62, 14, C.text, 'center');
  }

  // Chọn màn: ngang = 5 ô một hàng, dọc = danh sách
  function selRect(i) {
    if (PORTRAIT) {
      const step = Math.min(50, Math.floor((H - 72) / LEVELS.length));
      return { x: 10, y: 36 + i * step, w: W - 20, h: step - 4 };
    }
    const per = 5, w = 40, gap = 6, total = per * w + (per - 1) * gap;
    return { x: (W - total) / 2 + (i % per) * (w + gap), y: 28 + Math.floor(i / per) * 50, w, h: 44 };
  }
  function drawMini(L, x, y, box) {
    const rows = L.rows, h = rows.length, w = rows[0].length;
    const cs = Math.floor(box / Math.max(w, h));
    const ox = x + (box - w * cs) / 2, oy = y + (box - h * cs) / 2;
    rows.forEach((r, yy) => [...r].forEach((c, xx) => {
      ctx.fillStyle = c === '#' ? C.black : C.white;
      ctx.fillRect(ox + xx * cs, oy + yy * cs, cs - 1, cs - 1);
    }));
  }
  function drawCheck(x, y) {
    ctx.fillStyle = C.good; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
    text('✓', x, y - 6, 12, C.panel, 'center', false);
  }
  function drawSelect() {
    drawBackdrop();
    text('CHỌN MÀN CHƠI', W / 2, 8, 20, C.accent, 'center');
    LEVELS.forEach((L, i) => {
      const r = selRect(i), sel = i === state.sel;
      const lift = sel && !PORTRAIT ? -2 + Math.sin(state.t * 6) : 0;
      const y = r.y + lift;
      ctx.fillStyle = sel ? C.accent : C.panelLine; ctx.fillRect(r.x - 1, y - 1, r.w + 2, r.h + 2);
      ctx.fillStyle = C.panel; ctx.fillRect(r.x, y, r.w, r.h);
      const done = save.cleared.includes(i);
      if (PORTRAIT) {
        const m = r.h - 6, big = r.h >= 36;
        drawMini(L, r.x + 4, y + 3, m);
        const w = L.rows[0].length, h = L.rows.length;
        const b = save.best[i];
        if (big) {
          text(`${i + 1}. ${L.name}`, r.x + m + 10, y + 5, 17, sel ? C.accent : C.text);
          const tier = i < 5 ? 'khởi động' : 'thử thách';
          text(`${w}×${h} · ${tier} · ${done ? `tốt nhất ${b}` : 'chưa qua'}`, r.x + m + 10, y + 22, 12, done ? C.good : C.dim);
        } else { // màn hình thấp: gọn một dòng
          text(`${i + 1}. ${L.name}`, r.x + m + 8, y + r.h / 2 - 8, 15, sel ? C.accent : C.text);
          text(`${w}×${h}`, r.x + r.w - (done ? 20 : 6), y + r.h / 2 - 6, 12, C.dim, 'right');
        }
        if (done) drawCheck(r.x + r.w - 10, y + r.h / 2);
      } else {
        text(String(i + 1), r.x + r.w / 2, y + 2, 16, sel ? C.accent : C.text, 'center');
        drawMini(L, r.x + 7, y + 16, 26);
        if (done) drawCheck(r.x + r.w - 4, y + 5);
      }
    });
    if (PORTRAIT) {
      text('Chạm vào một màn để chơi', W / 2, H - 26, 14, C.dim, 'center');
      return;
    }
    const L = LEVELS[state.sel];
    const h = L.rows.length, w = L.rows[0].length;
    text(`${state.sel + 1}. ${L.name}  (${w}×${h})`, W / 2, 124, 16, C.text, 'center');
    const b = save.best[state.sel];
    text(b ? `Đã qua · tốt nhất ${b} lượt thử` : 'Chưa hoàn thành', W / 2, 137, 12, b ? C.good : C.dim, 'center');
    text('Mũi tên: chọn · Z: chơi · X: quay lại', W / 2, 149, 11, C.dim, 'center');
  }

  function drawEnding() {
    drawBackdrop();
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4 + state.endT * 0.7, r = 20 + ((i * 37) % 60) + Math.sin(state.endT * 2 + i) * 6;
      const sx = PORTRAIT ? 1 : 1.6, sy = PORTRAIT ? 2 : 1;
      const x = W / 2 + Math.cos(a) * r * sx, y = H / 2 + Math.sin(a) * r * sy;
      drawTile(x, y, 8, (i + Math.floor(state.endT * 3)) % 2);
    }
    const by = Math.round(H / 2 - 30);
    ctx.fillStyle = '#0b0c1cdd'; ctx.fillRect(0, by, W, 60);
    text('CHÚC MỪNG!', W / 2, by + 4, 32, C.accent, 'center');
    text(`Bạn đã hoàn thành cả ${LEVELS.length} màn`, W / 2, by + 36, 16, C.text, 'center');
    if (Math.floor(state.t * 2) % 2 === 0) text('Chạm: về chọn màn', W / 2, by + 80, 14, C.dim, 'center');
  }

  function render() {
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (state.screen === 'title') drawTitle();
    else if (state.screen === 'select') drawSelect();
    else if (state.screen === 'ending') drawEnding();
    else { drawBackdrop(); drawBoard(); drawPanel(); drawWinOverlay(); }
  }

  // ---- Điều khiển bàn phím ----
  const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  const isConfirm = k => k === 'z' || k === 'Enter' || k === ' ' || k === 'j';
  const isCancel = k => k === 'x' || k === 'Escape' || k === 'Backspace' || k === 'k';

  window.addEventListener('keydown', e => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (DIRS[k] || k === ' ' || k === 'Backspace') e.preventDefault();
    if (DIRS[k]) state.keys = true;
    if (helpOpen()) { if (isConfirm(k) || isCancel(k)) { e.preventDefault(); closeHelp(); } return; }
    if (k === 'm') { toggleSound(); return; }
    if (k === '?' || k === '/') { openHelp(); return; }

    if (state.screen === 'title') { if (isConfirm(k)) { state.screen = 'select'; sfx.select(); } return; }
    if (state.screen === 'ending') { if (isConfirm(k) || isCancel(k)) { state.screen = 'select'; sfx.select(); } return; }
    if (state.screen === 'select') {
      if (DIRS[k]) { const d = DIRS[k][0] || DIRS[k][1] * (PORTRAIT ? 1 : 5); state.sel = (state.sel + d + LEVELS.length) % LEVELS.length; sfx.move(); }
      else if (isConfirm(k)) { loadLevel(state.sel); sfx.select(); }
      else if (isCancel(k)) { state.screen = 'title'; sfx.cancel(); }
      return;
    }

    // play
    if (P.phase === 'win') { if (isConfirm(k)) nextLevel(); else if (isCancel(k)) toSelect(); return; }
    if (k === 'r') { const t = P.tries; resetBoard(); P.tries = t; sfx.cancel(); return; }
    if (k === 'h') { toggleHint(); return; }
    if (P.phase === 'idle') {
      if (DIRS[k]) {
        const nx = P.cursor.x + DIRS[k][0], ny = P.cursor.y + DIRS[k][1];
        if (inExt(nx, ny)) { P.cursor = { x: nx, y: ny }; sfx.move(); } else sfx.bump();
      } else if (isConfirm(k)) beginPath(P.cursor.x, P.cursor.y);
      else if (k === 'Escape') { toSelect(); sfx.cancel(); }
    } else if (P.phase === 'draw' && !P.mouseDraw) {
      if (DIRS[k]) { const l = P.path[P.path.length - 1]; tryStep(l.x + DIRS[k][0], l.y + DIRS[k][1]); }
      else if (isConfirm(k)) commit();
      else if (isCancel(k)) cancelPath();
    }
  });

  // ---- Chuột / cảm ứng ----
  function toLogical(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  }
  function toCell(p) {
    return { x: Math.floor((p.x - P.gx) / P.cs) - 1, y: Math.floor((p.y - P.gy) / P.cs) - 1 };
  }

  cv.addEventListener('pointerdown', e => {
    state.keys = false;
    e.preventDefault();
    const p = toLogical(e);
    if (state.screen === 'title') { state.screen = 'select'; sfx.select(); return; }
    if (state.screen === 'ending') { state.screen = 'select'; sfx.select(); return; }
    if (state.screen === 'select') {
      for (let i = 0; i < LEVELS.length; i++) {
        const r = selRect(i);
        if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y - 4 && p.y <= r.y + r.h + 4) {
          if (state.sel === i || e.pointerType !== 'mouse') { state.sel = i; loadLevel(i); sfx.select(); }
          else { state.sel = i; sfx.move(); }
          return;
        }
      }
      return;
    }
    if (P.phase === 'win') { nextLevel(); return; }
    if (P.phase !== 'idle') return;
    const c = toCell(p);
    if (inExt(c.x, c.y) && beginPath(c.x, c.y)) {
      P.mouseDraw = true;
      cv.setPointerCapture(e.pointerId);
    }
  });
  cv.addEventListener('pointermove', e => {
    if (state.screen !== 'play' || !P.mouseDraw || P.phase !== 'draw') return;
    const c = toCell(toLogical(e));
    dragTo(Math.max(-1, Math.min(P.w, c.x)), Math.max(-1, Math.min(P.h, c.y)));
  });
  const endPointer = () => {
    if (state.screen !== 'play' || !P.mouseDraw || P.phase !== 'draw') return;
    if (P.path.length < 2) cancelPath(); else commit();
  };
  cv.addEventListener('pointerup', endPointer);
  cv.addEventListener('pointercancel', () => { if (P && P.mouseDraw) cancelPath(); });
  cv.addEventListener('dblclick', e => e.preventDefault());

  // ---- Nút HTML ----
  function toggleSound() {
    muted = !muted;
    const b = document.getElementById('btn-sound');
    b.querySelector('.ico').textContent = muted ? '🔇' : '🔊';
    b.querySelector('.lbl').textContent = muted ? 'Tắt tiếng' : 'Âm thanh';
  }
  document.getElementById('btn-sound').onclick = toggleSound;
  document.getElementById('btn-reset').onclick = () => {
    if (state.screen === 'play' && P.phase !== 'win') { const t = P.tries; resetBoard(); P.tries = t; sfx.cancel(); }
  };
  document.getElementById('btn-hint').onclick = () => { if (state.screen === 'play') toggleHint(); };
  document.getElementById('btn-menu').onclick = () => { toSelect(); sfx.cancel(); };
  // ---- Cửa sổ Cách chơi ----
  const helpEl = document.getElementById('help-modal');
  const HELP_KEY = 'polarium-js-help-seen';
  function seenHelp() { try { return localStorage.getItem(HELP_KEY) === '1'; } catch (e) { return true; } }
  function helpOpen() { return !helpEl.hidden; }
  function openHelp() { helpEl.hidden = false; if (P && P.phase === 'draw') cancelPath(); }
  function closeHelp() {
    helpEl.hidden = true;
    try { localStorage.setItem(HELP_KEY, '1'); } catch (e) {}
  }
  document.getElementById('btn-help').onclick = openHelp;
  document.getElementById('help-close').onclick = closeHelp;
  helpEl.addEventListener('pointerdown', e => { if (e.target === helpEl) closeHelp(); });

  document.querySelectorAll('button').forEach(b => b.addEventListener('keydown', e => e.preventDefault()));

  applyLayout();
  // ---- Vòng lặp ----
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    update(dt); render();
    requestAnimationFrame(frame);
  }
  const go = () => { applyLayout(); requestAnimationFrame(t => { last = t; frame(t); }); };
  if (document.fonts && document.fonts.load) {
    Promise.race([document.fonts.load(`16px "VT323"`), new Promise(r => setTimeout(r, 1500))]).then(go, go);
  } else go();
})();
