const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Game Constants ────────────────────────────────────────────
const PHASE = { WAITING:'waiting', COUNTDOWN:'countdown', FIGHTING:'fighting', KNOCKDOWN:'knockdown', ROUND_END:'roundEnd', GAME_OVER:'gameOver' };
const PUNCH_DAMAGE  = { jab:7, cross:11, hook:14, uppercut:18 };
const PUNCH_RANGE   = 2.0;
const PUNCH_COOLDOWN= 380;
const STAMINA_COST  = 12;
const STAMINA_REGEN = 14;
const BLOCK_FACTOR  = 0.25;
const ROUND_TIME    = 180;
const RING_SIZE     = 5.5;

// ─── State ────────────────────────────────────────────────────
let players = {};
let game = { phase: PHASE.WAITING, round: 1, maxRounds: 3, timer: ROUND_TIME };
let countdownInterval = null;
let koInterval = null;

function getIds() { return Object.keys(players); }

function broadcast() {
  io.emit('state', {
    phase: game.phase, round: game.round, timer: Math.ceil(game.timer),
    players: Object.fromEntries(Object.entries(players).map(([id, p]) => [id, {
      x:p.x, z:p.z, ry:p.ry, health:p.health, stamina:p.stamina,
      state:p.state, idx:p.idx, name:p.name, score:p.score, knockdowns:p.knockdowns
    }]))
  });
}

function resetRound() {
  const ids = getIds();
  ids.forEach((id, i) => {
    Object.assign(players[id], {
      x: i === 0 ? -1.8 : 1.8, z: 0,
      ry: i === 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
      health: 100, stamina: 100, state: 'idle', isBlocking: false,
      lastPunch: 0, hitCooldown: 0
    });
  });
}

function startCountdown() {
  resetRound();
  game.phase = PHASE.COUNTDOWN;
  game.timer = 3;
  broadcast();
  let c = 3;
  clearInterval(countdownInterval);
  countdownInterval = setInterval(() => {
    c--;
    if (c <= 0) {
      clearInterval(countdownInterval);
      game.phase = PHASE.FIGHTING;
      game.timer = ROUND_TIME;
      broadcast();
    } else {
      game.timer = c;
      broadcast();
    }
  }, 1000);
}

function endRound(koWinnerId = null) {
  clearInterval(koInterval);
  game.phase = koWinnerId ? PHASE.GAME_OVER : PHASE.ROUND_END;
  const ids = getIds();
  if (ids.length === 2) {
    if (koWinnerId) {
      players[koWinnerId].score += 3;
    } else {
      const [a, b] = ids.map(id => players[id]);
      if (a.health > b.health) a.score++;
      else if (b.health > a.health) b.score++;
    }
  }
  broadcast();
  if (!koWinnerId) {
    setTimeout(() => {
      if (game.round >= game.maxRounds) {
        game.phase = PHASE.GAME_OVER;
        broadcast();
      } else {
        game.round++;
        startCountdown();
      }
    }, 6000);
  }
}

// ─── Server Tick ──────────────────────────────────────────────
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;

  if (game.phase === PHASE.FIGHTING) {
    game.timer -= dt;
    for (const id in players) {
      const p = players[id];
      if (p.state !== 'punching') p.stamina = Math.min(100, p.stamina + STAMINA_REGEN * dt);
      if (p.hitCooldown > 0) p.hitCooldown -= dt;
    }
    if (game.timer <= 0) endRound();
  }
  if (game.phase === PHASE.FIGHTING) broadcast();
}, 50);

// ─── Socket Handlers ──────────────────────────────────────────
io.on('connection', socket => {
  const ids = getIds();
  if (ids.length >= 2) { socket.emit('full'); return; }

  const idx = ids.length;
  players[socket.id] = {
    id: socket.id, idx, name: `Fighter ${idx + 1}`,
    x: idx === 0 ? -1.8 : 1.8, z: 0,
    ry: idx === 0 ? Math.PI * 0.5 : -Math.PI * 0.5,
    health: 100, stamina: 100, state: 'idle',
    score: 0, knockdowns: 0, isBlocking: false,
    lastPunch: 0, hitCooldown: 0
  };

  socket.emit('joined', { id: socket.id, idx });
  broadcast();

  if (getIds().length === 2 && game.phase === PHASE.WAITING) {
    setTimeout(startCountdown, 1500);
  }

  // ── Input ─────────────────────────────
  socket.on('move', ({ dx, dz, dt: clientDt }) => {
    const p = players[socket.id];
    if (!p || game.phase !== PHASE.FIGHTING) return;
    if (p.state === 'knockdown') return;
    const dt = Math.min(clientDt, 0.05);
    const speed = 4.5;
    p.x = Math.max(-RING_SIZE, Math.min(RING_SIZE, p.x + dx * speed * dt));
    p.z = Math.max(-RING_SIZE, Math.min(RING_SIZE, p.z + dz * speed * dt));

    // Face opponent
    const opp = Object.values(players).find(pl => pl.id !== socket.id);
    if (opp) p.ry = Math.atan2(opp.x - p.x, opp.z - p.z);
  });

  socket.on('block', ({ blocking }) => {
    const p = players[socket.id];
    if (!p || game.phase !== PHASE.FIGHTING) return;
    p.isBlocking = blocking;
    if (p.state !== 'knockdown' && p.state !== 'punching') {
      p.state = blocking ? 'blocking' : 'idle';
    }
  });

  socket.on('punch', ({ type }) => {
    const p = players[socket.id];
    if (!p || game.phase !== PHASE.FIGHTING) return;
    if (p.state === 'knockdown') return;
    const now = Date.now();
    if (now - p.lastPunch < PUNCH_COOLDOWN) return;
    if (p.stamina < STAMINA_COST) return;

    p.lastPunch = now;
    p.stamina -= STAMINA_COST;
    p.state = 'punching';
    setTimeout(() => { if (players[socket.id] && players[socket.id].state === 'punching') players[socket.id].state = 'idle'; }, 400);

    // Hit detection
    const opp = Object.values(players).find(pl => pl.id !== socket.id);
    if (!opp) return;

    const dx = opp.x - p.x, dz = opp.z - p.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > PUNCH_RANGE) return;

    const facingAngle = Math.atan2(dx, dz);
    const diff = Math.abs(((facingAngle - p.ry + Math.PI) % (2 * Math.PI)) - Math.PI);
    if (diff > Math.PI * 0.65) return;

    const base = PUNCH_DAMAGE[type] || 8;
    const blocked = opp.isBlocking;
    const dmg = blocked ? base * BLOCK_FACTOR : base;

    opp.health = Math.max(0, opp.health - dmg);

    io.emit('hit', { from: socket.id, to: opp.id, type, dmg, blocked, oppHealth: opp.health });

    // Knockdown check
    const hardHit = !blocked && dmg >= 11 && Math.random() < 0.35;
    if (opp.health <= 0 || hardHit) {
      opp.state = 'knockdown';
      opp.knockdowns++;
      opp.health = Math.max(0, opp.health);

      if (opp.health <= 0) {
        // Knockout count
        game.phase = PHASE.KNOCKDOWN;
        let c = 10;
        io.emit('ko_start', { loser: opp.id, winner: socket.id });
        koInterval = setInterval(() => {
          c--;
          io.emit('ko_count', { count: c, loser: opp.id });
          if (c <= 0) {
            clearInterval(koInterval);
            io.emit('ko_end', { winner: socket.id, loser: opp.id });
            endRound(socket.id);
          }
        }, 1000);
      } else {
        // Knockdown but not KO
        setTimeout(() => {
          if (players[opp.id]) {
            players[opp.id].state = 'rising';
            players[opp.id].health = Math.max(opp.health + 15, 15);
            setTimeout(() => { if (players[opp.id]) players[opp.id].state = 'idle'; }, 1500);
          }
        }, 4000);
      }
    }
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    clearInterval(countdownInterval);
    clearInterval(koInterval);
    if (getIds().length < 2) {
      game = { phase: PHASE.WAITING, round: 1, maxRounds: 3, timer: ROUND_TIME };
    }
    broadcast();
  });
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  let lanIP = 'localhost';
  for (const iface of Object.values(nets)) {
    for (const net of iface) {
      if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
    }
  }
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     🥊  KNOCKOUT - LAN BOXING  🥊     ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Local:  http://localhost:${PORT}        ║`);
  console.log(`║  LAN:    http://${lanIP}:${PORT}    ║`);
  console.log('║                                      ║');
  console.log('║  Share the LAN URL with your opponent║');
  console.log('╚══════════════════════════════════════╝\n');
});
