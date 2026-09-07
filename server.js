/**
 * 炸金花 · 好友联机服务端
 * 核心：每个玩家只会收到【自己】的手牌，别人的是 null —— 服务端隔离，客户端看不到也改不了。
 * 启动：node server.js   （默认 3000 端口，可用 PORT=8080 修改）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

let WebSocket;
try {
  WebSocket = require('ws');
} catch (e) {
  console.error('缺少依赖 ws，请先运行：npm install');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const ROOM_TTL = 6 * 3600 * 1000;   // 房间 6 小时无活动回收

/* ==================== 牌与牌型 ==================== */
const RANK_TXT = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

function evalHand(c) {
  const rs = c.map(x => x.r).sort((a, b) => b - a);
  const flush = c[0].s === c[1].s && c[1].s === c[2].s;
  let straight = false, sHigh = 0;
  if (rs[0] - 1 === rs[1] && rs[1] - 1 === rs[2]) { straight = true; sHigh = rs[0]; }
  else if (rs[0] === 14 && rs[1] === 3 && rs[2] === 2) { straight = true; sHigh = 3; } // A23 最小
  const is235 = rs[0] === 5 && rs[1] === 3 && rs[2] === 2 && !flush;

  if (rs[0] === rs[1] && rs[1] === rs[2]) return { t: 6, n: '豹子', key: [rs[0]] };
  if (is235 && RULE_235) return { t: 7, n: '特殊235', key: [5] };
  if (straight && flush) return { t: 5, n: '顺金', key: [sHigh] };
  if (flush) return { t: 4, n: '金花', key: rs };
  if (straight) return { t: 3, n: '顺子', key: [sHigh] };
  if (rs[0] === rs[1]) return { t: 2, n: '对子', key: [rs[0], rs[2]] };
  if (rs[1] === rs[2]) return { t: 2, n: '对子', key: [rs[1], rs[0]] };
  return { t: 1, n: '散牌', key: rs };
}
let RULE_235 = false;   // 每个房间独立设置，比较时按房间传入

function evalHandEx(c, r235) {
  RULE_235 = r235;
  return evalHand(c);
}
function cmpHand(a, b, r235) {
  const A = evalHandEx(a, r235), B = evalHandEx(b, r235);
  if (A.t !== B.t) return A.t > B.t ? 1 : -1;
  for (let i = 0; i < A.key.length; i++) {
    if (A.key[i] !== B.key[i]) return A.key[i] > B.key[i] ? 1 : -1;
  }
  return 0;   // 完全一样 → 发起方判负
}

/* ==================== 房间 ==================== */
const rooms = new Map();   // roomId -> room

function newRoom(id) {
  return {
    id,
    cfg: { ante: 1, maxbet: 20, chips: 200, maxround: 4, cmpcost: 1, r235: 0, credit: 1 },
    players: [],       // {pid,name,chips,hand,status,watching,roundBet,totalBet,hasActed,connected,host,seat}
    deck: [],
    pot: 0, curBet: 0, round: 1, dealerSeat: -1, turnIdx: 0,
    phase: 'lobby',    // lobby | playing | over
    log: [], result: null, revealAll: false,
    lastAct: Date.now(),
    sockets: new Map() // pid -> ws
  };
}
function getRoom(id) {
  let r = rooms.get(id);
  if (!r) { r = newRoom(id); rooms.set(id, r); }
  r.lastAct = Date.now();
  return r;
}
function alive(r) { return r.players.filter(p => p.status === 'active'); }
function seats(r) { return r.players.filter(p => p.status !== 'wait'); }

/* ==================== 发牌 / 下注 ==================== */
function deal(r) {
  const deck = [];
  for (let s = 0; s < 4; s++) for (let rr = 2; rr <= 14; rr++) deck.push({ r: rr, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  r.deck = deck;
  return deck;
}

function startHand(r) {
  r.phase = 'playing';
  r.pot = 0; r.curBet = 0; r.round = 1; r.result = null; r.revealAll = false; r.log = [];
  const playing = r.players.filter(p => p.status !== 'wait');
  if (playing.length < 2) { r.phase = 'lobby'; pushAll(r); return; }

  r.dealerSeat = (r.dealerSeat + 1) % r.players.length;

  const deck = deal(r);
  let k = 0;
  r.players.forEach(p => {
    if (p.status === 'wait') { p.hand = []; return; }
    p.hand = [deck[k++], deck[k++], deck[k++]];
    p.status = (p.chips <= 0 && !r.cfg.credit) ? 'out' : 'active';
    p.watching = false; p.roundBet = 0; p.totalBet = 0; p.hasActed = false;
  });

  seatAnte(r);
  log(r, `庄家：${r.players[r.dealerSeat].name}｜每人底注 ${r.cfg.ante}`);

  r.turnIdx = nextFrom(r, r.dealerSeat);
  if (alive(r).length <= 1) { finish(r, alive(r)[0]); return; }
  pushAll(r);
}

function pay(r, p, amt) {
  if (amt <= 0) return;
  if (amt > p.chips && !r.cfg.credit) amt = p.chips;   // 非记账模式只能 all-in
  p.chips -= amt; r.pot += amt; p.roundBet += amt; p.totalBet += amt;
}
// 底注入池，但不计入本圈已投注 —— 跟注时另付全额，而不是补差价
function seatAnte(r) {
  r.players.forEach(p => {
    if (p.status !== 'active') return;
    let a = r.cfg.ante;
    if (a > p.chips && !r.cfg.credit) a = p.chips;
    p.chips -= a; r.pot += a; p.totalBet += a;
  });
}
function due(r, p) { return p.watching ? r.curBet * 2 : r.curBet; }   // 闷牌=看牌的一半
function owed(r, p) { return Math.max(0, due(r, p) - p.roundBet); }
function nextFrom(r, idx) {
  const n = r.players.length;
  for (let i = 1; i <= n; i++) {
    const j = (idx + i) % n;
    if (r.players[j].status === 'active') return j;
  }
  return -1;
}
function log(r, t) { r.log.unshift(t); if (r.log.length > 60) r.log.pop(); }

/* ==================== 行动 ==================== */
function act(r, p, msg) {
  if (r.phase !== 'playing') return err(p, '当前不在牌局中');
  const cur = r.players[r.turnIdx];
  if (!cur || cur.pid !== p.pid) return err(p, '还没轮到你');

  const a = msg.a;
  if (a === 'see') {
    if (p.watching) return err(p, '你已经看过牌了');
    p.watching = true; log(r, `${p.name} 看了牌`);
    pushAll(r); return;              // 看完牌回合不转移，本人继续下注
  } else if (a === 'call') {
    const o = owed(r, p);
    if (o > 0) { pay(r, p, o); log(r, `${p.name} 跟注 ${o}`); }
    else log(r, `${p.name} 过牌`);
    p.hasActed = true;
  } else if (a === 'raise') {
    let nb = Math.floor(msg.v);
    if (!(nb > r.curBet)) return err(p, '加注必须高于当前注 ' + r.curBet);
    if (nb > r.cfg.maxbet) return err(p, '超过单注上限 ' + r.cfg.maxbet);
    const target = p.watching ? nb * 2 : nb;
    const need = target - p.roundBet;
    if (need <= 0) return err(p, '请输入更高的注额');
    pay(r, p, need);
    r.curBet = nb;
    log(r, `${p.name} 加注到 ${nb}${p.watching ? '（看牌实付 ' + target + '）' : '（闷牌实付 ' + target + '）'}`);
    r.players.forEach(x => { if (x !== p && x.status === 'active') x.hasActed = false; });
    p.hasActed = true;
  } else if (a === 'fold') {
    p.status = 'folded'; p.hasActed = true;
    log(r, `${p.name} 弃牌（继续观战）`);
  } else if (a === 'compare') {
    const t = r.players.find(x => x.pid === msg.target);
    if (!t || t.status !== 'active' || t.pid === p.pid) return err(p, '比牌对象无效');
    if (p.watching && !t.watching) return err(p, '看牌玩家不能主动向闷牌玩家发起比牌');
    const extra = r.cfg.cmpcost ? due(r, p) : 0;
    pay(r, p, owed(r, p) + extra);
    if (t.roundBet < due(r, t)) pay(r, t, owed(r, t));
    p.hasActed = true;

    const res = cmpHand(p.hand, t.hand, r.cfg.r235);
    let winner, loser;
    if (res === 0) { winner = t; loser = p; log(r, `${p.name} 发起比牌，牌力完全相同 → 发起方判负`); }
    else if (res > 0) { winner = p; loser = t; }
    else { winner = t; loser = p; }
    loser.status = 'out';
    log(r, `${p.name} 与 ${t.name} 比牌 → ${winner.name} 胜，${loser.name} 出局（牌销毁不公开）`);

    if (alive(r).length <= 1) { finish(r, alive(r)[0]); return pushAll(r); }
  } else {
    return err(p, '未知操作');
  }

  if (alive(r).length <= 1) { finish(r, alive(r)[0]); return pushAll(r); }
  advance(r);
  pushAll(r);
}

function advance(r) {
  const n = r.players.length;
  for (let i = 1; i <= n; i++) {
    const j = (r.turnIdx + i) % n, x = r.players[j];
    if (x.status === 'active' && (!x.hasActed || owed(r, x) > 0)) { r.turnIdx = j; return; }
  }
  endRound(r);
}
function endRound(r) {
  if (alive(r).length <= 1) { finish(r, alive(r)[0]); return; }
  r.round++;
  if (r.round > r.cfg.maxround) {
    log(r, `已达 ${r.cfg.maxround} 轮上限，自动开牌`);
    return showdown(r);
  }
  r.players.forEach(p => { p.hasActed = false; p.roundBet = 0; });
  const nx = nextFrom(r, r.dealerSeat);
  if (nx < 0) { finish(r, null); return; }
  r.turnIdx = nx;
  log(r, `—— 第 ${r.round} 轮开始（当前注 ${r.curBet}）——`);
}
function showdown(r) {
  const a = alive(r);
  if (!a.length) return finish(r, null);
  let w = a[0];
  a.forEach(p => { if (cmpHand(p.hand, w.hand, r.cfg.r235) > 0) w = p; });
  finish(r, w);
}
function finish(r, w) {
  r.phase = 'over';
  r.result = {
    winnerName: w ? w.name : '无人',
    winnerPid: w ? w.pid : null,
    pot: r.pot,
    hands: []
  };
  const ranks = alive(r).concat(r.players.filter(p => p.status === 'out'));
  ranks.forEach(p => {
    r.result.hands.push({
      name: p.name, pid: p.pid,
      hand: p.hand,
      rankName: evalHandEx(p.hand, r.cfg.r235).n
    });
  });
  if (w) { w.chips += r.pot; log(r, `${w.name} 收下底池 ${r.pot}（${evalHandEx(w.hand, r.cfg.r235).n}）`); }
  else log(r, '本局无人存活');
}

/* ==================== 视图（按人定制） ==================== */
function view(r, me) {
  const showAll = r.revealAll || r.phase === 'over';
  // 自己的牌：只有点了"看牌"之后（或开牌/公布时）才下发 —— 没看牌就是真的拿不到
  const selfShow = me.watching || showAll;
  const myHand = (selfShow && me.hand && me.hand.length) ? me.hand : null;
  const publicOf = p => (showAll && p.hand && p.hand.length &&
    (p.status === 'active' || p.status === 'out'));
  return {
    t: 'state',
    room: r.id,
    phase: r.phase,
    cfg: r.cfg,
    pot: r.pot, curBet: r.curBet, round: r.round,
    dealerPid: r.dealerSeat >= 0 && r.players[r.dealerSeat] ? r.players[r.dealerSeat].pid : null,
    turnPid: (r.phase === 'playing' && r.players[r.turnIdx]) ? r.players[r.turnIdx].pid : null,
    log: r.log,
    revealAll: r.revealAll,
    me: {
      pid: me.pid, name: me.name, isHost: !!me.host,
      hand: myHand,
      watching: me.watching,
      chips: me.chips,
      roundBet: me.roundBet,          // 本圈已投，客户端用来算"还差多少"
      handCount: me.hand ? me.hand.length : 0
    },
    players: r.players.map(p => ({
      pid: p.pid, name: p.name, chips: p.chips,
      status: p.status, watching: p.watching, totalBet: p.totalBet,
      connected: p.connected, host: !!p.host,
      // 关键：别人永远只能看到牌背；结算 / 主动公布时才公开
      hand: (p.pid === me.pid) ? myHand : (publicOf(p) ? p.hand : null),
      handCount: p.hand ? p.hand.length : 0,
      rankName: publicOf(p) ? evalHandEx(p.hand, r.cfg.r235).n : null
    })),
    result: r.phase === 'over' ? r.result : null,
    myRankName: myHand ? evalHandEx(myHand, r.cfg.r235).n : null
  };
}

/* ==================== 网络 ==================== */
function pushAll(r) {
  r.players.forEach(p => {
    const ws = r.sockets.get(p.pid);
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(view(r, p)));
  });
}
function err(p, msg) {
  const ws = p.__ws;
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'toast', msg }));
}
function findPlayer(r, pid) { return r.players.find(p => p.pid === pid); }
function genPid() { return Math.random().toString(36).slice(2, 10); }

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws, req) => {
  let room = null, me = null;
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'join') {
      const rid = String(m.room || '').trim().toUpperCase().slice(0, 10);
      const name = String(m.name || '').trim().slice(0, 8);
      if (!rid || !name) return ws.send(JSON.stringify({ t: 'toast', msg: '房间号和昵称都要填' }));
      room = getRoom(rid);
      if (room.players.length >= 9 && !findPlayer(room, m.pid)) {
        return ws.send(JSON.stringify({ t: 'toast', msg: '房间已满（最多 9 人）' }));
      }
      let p = m.pid ? findPlayer(room, m.pid) : null;
      if (p) {                       // 断线重连
        p.name = name; p.connected = true;
      } else {
        p = {
          pid: genPid(), name, chips: room.cfg.chips, hand: [],
          status: room.phase === 'playing' ? 'wait' : 'active',
          watching: false, roundBet: 0, totalBet: 0, hasActed: false,
          connected: true, host: room.players.length === 0
        };
        room.players.push(p);
        log(room, `${name} 加入房间`);
      }
      if (room.phase === 'playing' && p.status === 'active') { /* 局中加入 → 等下局 */ }
      me = p; p.__ws = ws;
      room.sockets.set(p.pid, ws);
      ws.send(JSON.stringify({ t: 'you', pid: p.pid, room: rid, name }));
      pushAll(room);
      return;
    }

    if (!room || !me) return;
    if (m.t === 'cfg') {
      if (!me.host) return err(me, '只有房主能改设置');
      if (room.phase === 'playing') return err(me, '牌局进行中不能改设置');
      const c = m.cfg || {};
      ['ante', 'maxbet', 'chips', 'maxround', 'cmpcost', 'r235', 'credit'].forEach(k => {
        if (c[k] !== undefined) room.cfg[k] = +c[k];
      });
      if (room.phase === 'lobby') room.players.forEach(p => p.chips = room.cfg.chips);
      pushAll(room); return;
    }
    if (m.t === 'start') {
      if (!me.host) return err(me, '只有房主能开局');
      if (room.players.length < 2) return err(me, '至少 2 人才能开局');
      room.players.forEach(p => { if (p.status === 'wait') p.status = 'active'; });
      startHand(room); return;
    }
    if (m.t === 'next') {
      if (!me.host) return err(me, '只有房主能开下一局');
      room.players.forEach(p => { if (p.status === 'wait') p.status = 'active'; });
      startHand(room); return;
    }
    if (m.t === 'act') { act(room, me, m); return; }
    if (m.t === 'reveal') {
      if (!me.host) return err(me, '只有房主能公布');
      room.revealAll = true; log(room, '房主公布了所有手牌'); pushAll(room); return;
    }
    if (m.t === 'reset') {
      if (!me.host) return err(me, '只有房主能重置');
      room.phase = 'lobby'; room.result = null; room.pot = 0; room.curBet = 0;
      room.players.forEach(p => { p.chips = room.cfg.chips; p.hand = []; p.status = 'active'; p.watching = false; });
      room.dealerSeat = -1; room.log = [];
      pushAll(room); return;
    }
  });

  ws.on('close', () => {
    if (me && room) { me.connected = false; room.sockets.delete(me.pid); pushAll(room); }
  });
});

// 心跳：清理死连接
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; ws.ping();
  });
  const now = Date.now();
  rooms.forEach((r, id) => {
    if (now - r.lastAct > ROOM_TTL && r.sockets.size === 0) rooms.delete(id);
  });
}, 30000);

/* ==================== HTTP ==================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(PUBLIC, path.normalize(p).replace(/^([.]{2}[/\\])+/, ''));
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(k => nets[k].forEach(n => {
    if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
  }));
  console.log('');
  console.log('  炸金花服务端已启动');
  console.log('  本机打开：  http://localhost:' + PORT);
  ips.forEach(ip => console.log('  同 WiFi 好友打开： http://' + ip + ':' + PORT));
  console.log('');
});
