const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Game constants ----------
const MAP_SIZE = 2400;
const TICK_RATE = 30; // server ticks per second
const TICK_MS = 1000 / TICK_RATE;

const WEAPONS = [
  { name: 'Pistol',  dmg: 8,  fireRate: 400, range: 300, speed: 14 },
  { name: 'SMG',     dmg: 6,  fireRate: 150, range: 280, speed: 16 },
  { name: 'Shotgun', dmg: 22, fireRate: 700, range: 180, speed: 14 },
  { name: 'Rifle',   dmg: 16, fireRate: 250, range: 450, speed: 18 }
];

const PLAYER_SPEED = 3.4;
const PLAYER_RADIUS = 14;
const RESTART_DELAY_MS = 8000;
const MIN_PLAYERS_TO_START = 1; // set to 2 to force needing a second player

// ---------- Game state ----------
let players = {};   // socket.id -> player object
let bullets = [];    // active bullets
let pickups = [];
let zone = null;
let gameState = 'waiting'; // waiting | running | ended
let gameStartTime = 0;
let restartTimer = null;
let bulletIdCounter = 0;

function rand(a, b) { return a + Math.random() * (b - a); }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

function spawnPickups() {
  pickups = [];
  for (let i = 0; i < 18; i++) {
    pickups.push({
      id: i,
      x: rand(100, MAP_SIZE - 100),
      y: rand(100, MAP_SIZE - 100),
      weaponIdx: Math.floor(rand(0, WEAPONS.length)),
      taken: false
    });
  }
}

function resetZone() {
  zone = {
    x: MAP_SIZE / 2,
    y: MAP_SIZE / 2,
    radius: MAP_SIZE * 0.55,
    shrinking: false,
    shrinkFrom: 0,
    shrinkTo: 0,
    shrinkStartTime: 0,
    shrinkDuration: 12000,
    nextShrinkAt: 8000,
    stage: 0
  };
}

function spawnPlayer(p) {
  p.x = rand(MAP_SIZE * 0.3, MAP_SIZE * 0.7);
  p.y = rand(MAP_SIZE * 0.3, MAP_SIZE * 0.7);
  p.hp = 100;
  p.weaponIdx = 0;
  p.alive = true;
  p.kills = 0;
  p.angle = 0;
  p.lastShot = 0;
  p.input = { mvx: 0, mvy: 0, angle: 0, shooting: false };
}

function startRound() {
  gameState = 'running';
  gameStartTime = Date.now();
  resetZone();
  spawnPickups();
  bullets = [];
  for (const id in players) spawnPlayer(players[id]);
  io.emit('roundStart');
}

function checkStartCondition() {
  const ids = Object.keys(players);
  if (gameState === 'waiting' && ids.length >= MIN_PLAYERS_TO_START) {
    startRound();
  }
}

function endRound(winnerId) {
  gameState = 'ended';
  io.emit('roundEnd', { winnerId, winnerName: winnerId && players[winnerId] ? players[winnerId].name : null });
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    gameState = 'waiting';
    checkStartCondition();
  }, RESTART_DELAY_MS);
}

function tryShoot(p, angle, now) {
  const w = WEAPONS[p.weaponIdx];
  if (now - p.lastShot < w.fireRate) return;
  p.lastShot = now;
  const makeBullet = (a) => {
    bullets.push({
      id: bulletIdCounter++,
      x: p.x, y: p.y,
      vx: Math.cos(a) * w.speed, vy: Math.sin(a) * w.speed,
      dmg: w.dmg, range: w.range, traveled: 0,
      ownerId: p.id, weaponIdx: p.weaponIdx
    });
  };
  if (w.name === 'Shotgun') {
    for (let i = -2; i <= 2; i++) makeBullet(angle + i * 0.08);
  } else {
    makeBullet(angle);
  }
}

function tick() {
  const now = Date.now();

  if (gameState === 'running') {
    // Move players based on last input
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      const { mvx, mvy, angle, shooting } = p.input;
      const len = Math.hypot(mvx, mvy);
      if (len > 0.01) {
        p.x += (mvx / len) * PLAYER_SPEED;
        p.y += (mvy / len) * PLAYER_SPEED;
      }
      p.x = Math.max(20, Math.min(MAP_SIZE - 20, p.x));
      p.y = Math.max(20, Math.min(MAP_SIZE - 20, p.y));
      p.angle = angle;
      if (shooting) tryShoot(p, angle, now);
    }

    // Zone shrink
    const elapsed = now - gameStartTime;
    if (!zone.shrinking && elapsed > zone.nextShrinkAt && zone.stage < 4) {
      zone.shrinking = true;
      zone.shrinkFrom = zone.radius;
      zone.shrinkTo = zone.radius * 0.55;
      zone.shrinkStartTime = now;
      zone.x += rand(-150, 150);
      zone.y += rand(-150, 150);
    }
    if (zone.shrinking) {
      const t = Math.min(1, (now - zone.shrinkStartTime) / zone.shrinkDuration);
      zone.radius = zone.shrinkFrom + (zone.shrinkTo - zone.shrinkFrom) * t;
      if (t >= 1) {
        zone.shrinking = false;
        zone.stage++;
        zone.nextShrinkAt = (now - gameStartTime) + 10000;
      }
    }

    // Zone damage
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      if (dist(p.x, p.y, zone.x, zone.y) > zone.radius) {
        p.hp -= 0.15 * TICK_MS;
      }
    }

    // Bullets move
    for (const b of bullets) {
      b.x += b.vx; b.y += b.vy;
      b.traveled += Math.hypot(b.vx, b.vy);
    }

    // Bullet collisions
    for (const b of bullets) {
      if (b.traveled >= b.range) continue;
      for (const id in players) {
        const target = players[id];
        if (!target.alive || target.id === b.ownerId) continue;
        if (dist(b.x, b.y, target.x, target.y) < PLAYER_RADIUS + 4) {
          target.hp -= b.dmg;
          b.traveled = b.range + 1; // mark dead
          if (target.hp <= 0 && target.alive) {
            target.alive = false;
            const shooter = players[b.ownerId];
            if (shooter) shooter.kills++;
          }
        }
      }
    }
    bullets = bullets.filter(b => b.traveled < b.range);

    // Pickups
    for (const pk of pickups) {
      if (pk.taken) continue;
      for (const id in players) {
        const p = players[id];
        if (p.alive && dist(p.x, p.y, pk.x, pk.y) < 28) {
          pk.taken = true;
          p.weaponIdx = pk.weaponIdx;
          break;
        }
      }
    }

    // Win condition
    const alivePlayers = Object.values(players).filter(p => p.alive);
    const totalPlayers = Object.keys(players).length;
    if (totalPlayers >= 2 && alivePlayers.length <= 1) {
      endRound(alivePlayers[0] ? alivePlayers[0].id : null);
    } else if (totalPlayers === 1 && alivePlayers.length === 0) {
      endRound(null);
    }
  }

  broadcastState();
}

function broadcastState() {
  const playerList = Object.values(players).map(p => ({
    id: p.id, name: p.name, x: p.x, y: p.y, hp: p.hp,
    weaponIdx: p.weaponIdx, alive: p.alive, angle: p.angle, kills: p.kills
  }));
  io.emit('state', {
    gameState,
    players: playerList,
    bullets: bullets.map(b => ({ x: b.x, y: b.y, weaponIdx: b.weaponIdx })),
    pickups: pickups.filter(p => !p.taken).map(p => ({ id: p.id, x: p.x, y: p.y, weaponIdx: p.weaponIdx })),
    zone,
    weapons: WEAPONS.map(w => ({ name: w.name })),
    mapSize: MAP_SIZE
  });
}

setInterval(tick, TICK_MS);

// ---------- Socket handling ----------
io.on('connection', (socket) => {
  const name = 'Player-' + socket.id.slice(0, 4);
  players[socket.id] = {
    id: socket.id, name,
    x: 0, y: 0, hp: 100, alive: false, weaponIdx: 0, kills: 0, angle: 0,
    lastShot: 0, input: { mvx: 0, mvy: 0, angle: 0, shooting: false }
  };

  socket.emit('init', {
    id: socket.id,
    mapSize: MAP_SIZE,
    weapons: WEAPONS.map(w => ({ name: w.name })),
    minPlayers: MIN_PLAYERS_TO_START
  });

  checkStartCondition();
  if (gameState !== 'running') {
    // if a round is already running, they wait as spectator until next round
  }

  socket.on('input', (data) => {
    const p = players[socket.id];
    if (!p) return;
    p.input = {
      mvx: Number(data.mvx) || 0,
      mvy: Number(data.mvy) || 0,
      angle: Number(data.angle) || 0,
      shooting: !!data.shooting
    };
  });

  socket.on('setName', (n) => {
    const p = players[socket.id];
    if (p && typeof n === 'string') p.name = n.slice(0, 16);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    if (gameState === 'running') {
      const alivePlayers = Object.values(players).filter(p => p.alive);
      if (alivePlayers.length <= 1 && Object.keys(players).length >= 1) {
        endRound(alivePlayers[0] ? alivePlayers[0].id : null);
      }
    }
  });
});

resetZone();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Battle Royale multiplayer server running on http://localhost:${PORT}`);
});
