// 自動玩家 + 每幀檢查。在遊戲頁面內執行。
window.runLevel = function (n) {
  const realNow = Date.now;
  let FAKE = realNow();
  Date.now = () => FAKE;
  try {
    Game.start(n);
    const g = Game.g;
    g.lives = 50;
    const TELEPORT = new Set(['blink', 'core', 'echo', 'cloneling']);
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const issues = { invisible: [], visJump: [], realJump: [], stuckOnZone: [] };
    const prevDrawn = new Map();
    const cache = new Map();
    let zoneEntries = 0, wasSafe = false, itemsUsed = 0, ticks = 0;
    DBG = { drawn: [] };

    const field = (tx, ty, door) => {
      const k = tx + ',' + ty + ',' + g.ver + ',' + door;
      if (cache.has(k)) return cache.get(k);
      const d = new Int32Array(g.W * g.H).fill(-1), q = [ty * g.W + tx];
      d[q[0]] = 0;
      for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % g.W, y = (c - x) / g.W;
        for (const [dx, dy] of DIRS) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= g.W || ny >= g.H) continue;
          const ni = ny * g.W + nx, v = g.grid[ni];
          if (d[ni] >= 0 || !(v === 0 || (v === 2 && door))) continue;
          d[ni] = d[c] + 1; q.push(ni);
        }
      }
      if (cache.size > 40) cache.clear();
      cache.set(k, d);
      return d;
    };
    const stepToward = (df) => {
      const cur = df[g.p.y * g.W + g.p.x];
      let best = null;
      for (const [dx, dy] of DIRS) {
        const ni = (g.p.y + dy) * g.W + g.p.x + dx;
        if (df[ni] >= 0 && df[ni] < cur) best = [dx, dy];
      }
      if (best) Game.tryMove(best, FAKE);
    };
    const threat = () => {
      let best = 99;
      for (const m of g.mons) {
        if (m.hidden || FAKE < m.stunUntil || (m.type === 'thief' && !g.hasKey)) continue;
        let d = g.distP[m.y * g.W + m.x];
        if (d < 0) d = Math.abs(m.x - g.p.x) + Math.abs(m.y - g.p.y);
        best = Math.min(best, d);
      }
      return best;
    };
    const bot = () => {
      if (FAKE < g.nextMove || FAKE < g.stuckUntil) return;
      const th = threat();
      const z = Game.safeZone();
      if (z && th <= 6 && z.energy > 1500) return;            // 在安全區等怪物走遠
      if (th <= 2) {
        for (const t of ['shield', 'stun', 'scroll']) if (g.inv[t] && !(t === 'shield' && FAKE < g.invUntil)) { Game.useItem(t); itemsUsed++; return; }
      }
      if (g.inv.lamp && FAKE >= g.lampUntil && Math.random() < 0.01) { Game.useItem('lamp'); itemsUsed++; }
      if (th <= 3 && !z) {
        const pf = field(g.p.x, g.p.y, false);
        let tz = null, td = 7;
        for (const s of g.safes) { const d = pf[s.y * g.W + s.x]; if (s.active && s.energy > 3000 && d >= 0 && d < td) { td = d; tz = s; } }
        if (tz) { stepToward(field(tz.x, tz.y, false)); return; }
      }
      const tgt = g.hasKey ? g.door : g.key;
      stepToward(field(tgt.x, tgt.y, g.hasKey));
    };

    const limit = g.limit + 25 * 60000;
    while (!g.over && FAKE - g.t0 < limit) {
      FAKE += 25; ticks++;
      bot();
      const before = g.mons.map(m => [m, m.x, m.y, m.hidden]);
      Game.tick();
      for (const [m, x, y, hid] of before) {
        if (m.dead || hid || m.hidden || TELEPORT.has(m.type)) continue;
        if (Math.abs(m.x - x) + Math.abs(m.y - y) > 1) issues.realJump.push({ type: m.type, from: [x, y], to: [m.x, m.y] });
        const zz = g.safeAt.get(m.y * g.W + m.x);
        if (zz && zz.active && m.type !== 'echo') issues.stuckOnZone.push({ type: m.type });
      }
      const s = !!Game.safeZone();
      if (s && !wasSafe) zoneEntries++;
      wasSafe = s;
      if (ticks % 2) continue;
      // ---- 每一幀檢查畫面 ----
      draw();
      const drawnCells = new Set(DBG.drawn.map(d => d.x + ',' + d.y));
      const drawnNow = new Map(DBG.drawn.map(d => [d.m, d]));
      const lamp = FAKE < g.lampUntil;
      const zl = new Set();
      for (const z of g.safes) if (z.active) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) zl.add((z.x + dx) + ',' + (z.y + dy));
      for (const m of g.mons) {
        if (m.hidden) continue;
        const ch = Math.max(Math.abs(m.x - g.p.x), Math.abs(m.y - g.p.y));
        const nearZone = zl.has(m.x + ',' + m.y) && ch <= DBG.R;
        if (nearZone) issues.nearZoneSeen = (issues.nearZoneSeen || 0) + 1;
        if (ch > DBG.vis && !nearZone) continue;
        if (m.type === 'shade' && !lamp && !(ch <= 1 || (FAKE % 2400) < 300)) continue;
        if (!drawnNow.has(m) && !drawnCells.has(m.x + ',' + m.y)) issues.invisible.push({ type: m.type, at: [m.x, m.y] });
      }
      for (const [m, d] of drawnNow) {
        const p = prevDrawn.get(m);
        if (p && !TELEPORT.has(m.type) && Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 1 && p.t === ticks - 2) issues.visJump.push({ type: m.type, from: [p.x, p.y], to: [d.x, d.y] });
        prevDrawn.set(m, { x: d.x, y: d.y, t: ticks });
      }
    }
    const res = {
      n, win: g.over && g.p.x === g.door.x && g.p.y === g.door.y,
      secs: Math.round((FAKE - g.t0) / 1000), limit: g.limit / 1000,
      caught: 50 - g.lives, zoneEntries, itemsUsed,
      invisible: issues.invisible.length, visJump: issues.visJump.length, realJump: issues.realJump.length, stuckOnZone: issues.stuckOnZone.length, nearZoneChecks: issues.nearZoneSeen || 0,
      samples: [issues.invisible[0], issues.visJump[0], issues.realJump[0], issues.stuckOnZone[0]].filter(Boolean)
    };
    return res;
  } finally {
    DBG = null;
    Date.now = realNow;
    Game.g = null;
  }
};
