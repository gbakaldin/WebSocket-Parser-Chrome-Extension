// Simulates the messages ws-interceptor would emit.
// Fires window.postMessage so the real overlay.js picks them up unchanged.

const WS_GAME   = 'wss://097.stgame.win/game/ws';
const WS_LOBBY  = 'wss://097.stgame.win/lobby/ws';

const TEMPLATES = [
  // server → client, cmd field, various payloads
  { url: WS_GAME, direction: 'server',
    parsed: { cmd: 1, playerId: 1291, x: 40, y: 72, state: 'active', balance: 1500.50 } },
  { url: WS_GAME, direction: 'server',
    parsed: { cmd: 42, event: 'spin_result', reels: [3,1,4,1,5], win: 0, multiplier: 1 } },
  { url: WS_GAME, direction: 'server',
    parsed: { cmd: 7, heartbeat: true, serverTime: 1714819200000 } },

  // client → server, c field
  { url: WS_GAME, direction: 'client',
    parsed: { c: 5, action: 'bet', amount: 100, currency: 'USD' } },
  { url: WS_GAME, direction: 'client',
    parsed: { c: 5, action: 'bet', amount: 500, currency: 'USD' } },

  // no cmd/c field at all
  { url: WS_GAME, direction: 'server',
    parsed: { type: 'ping', ts: 0 } },

  // array at top level
  { url: WS_GAME, direction: 'server',
    parsed: [{ id: 1, name: 'Event A' }, { id: 2, name: 'Event B' }] },

  // cmd buried several levels deep
  { url: WS_GAME, direction: 'server',
    parsed: { envelope: { meta: { cmd: 77, seq: 3 }, payload: { data: 'abc' } } } },

  // cmd inside an array element
  { url: WS_GAME, direction: 'server',
    parsed: { events: [{ type: 'update' }, { cmd: 88, value: 42 }] } },

  // lobby connection — separate tab
  { url: WS_LOBBY, direction: 'server',
    parsed: { cmd: 100, games: ['slots', 'roulette', 'blackjack'], featured: 'slots' } },
  { url: WS_LOBBY, direction: 'client',
    parsed: { c: 101, action: 'join_game', gameId: 'slots-classic' } },

  // large payload — tests preview truncation and sheet scrolling
  { url: WS_GAME, direction: 'server',
    parsed: {
      cmd: 99,
      fullState: {
        player: { id: 1291, name: 'TestUser', balance: 1500.50, level: 42, xp: 18750 },
        game: {
          id: 'slots-classic', round: 8821,
          reels: [[1,2,3],[4,5,6],[7,8,9],[1,3,5],[2,4,6]],
          paylines: Array.from({ length: 20 }, (_, i) => ({ id: i, active: i % 2 === 0 })),
          bonusFeatures: { freeSpins: 0, multiplier: 1, wildExpansion: false },
        },
        session: { startedAt: 1714819000000, duration: 200, betsPlaced: 12, totalWagered: 1200 },
      },
    }
  },
];

function deepFindCmd(val) {
  if (val == null || typeof val !== 'object') return null;
  if (Array.isArray(val)) {
    for (const item of val) {
      const found = deepFindCmd(item);
      if (found !== null) return found;
    }
    return null;
  }
  const raw = val.cmd ?? val.c;
  if (raw != null) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  for (const v of Object.values(val)) {
    const found = deepFindCmd(v);
    if (found !== null) return found;
  }
  return null;
}

function buildRecord(tpl) {
  const raw = JSON.stringify(tpl.parsed);
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    direction: tpl.direction,
    url: tpl.url,
    raw,
    parsed: tpl.parsed,
    cmd: deepFindCmd(tpl.parsed),
    preview: raw.slice(0, 120),
  };
}

function send(record) {
  window.postMessage({ type: 'WS_INSPECTOR_MESSAGE', payload: record }, '*');
}

// Emit initial batch
let delay = 0;
for (const tpl of TEMPLATES) {
  setTimeout(() => send(buildRecord(tpl)), delay);
  delay += 60;
}

// Trickle in new messages to simulate live traffic
setTimeout(() => {
  const live = [TEMPLATES[0], TEMPLATES[1], TEMPLATES[3], TEMPLATES[7]];
  setInterval(() => {
    const tpl = live[Math.floor(Math.random() * live.length)];
    send(buildRecord(tpl));
  }, 1500);
}, delay + 300);
