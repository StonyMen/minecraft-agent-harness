// 诊断脚本：量化"走路被方块卡住/拐角卡住"的真实原因。
// 不改动世界（canDig=false），只走路并记录每个物理 tick 的位移、
// 水平碰撞标志、路径重置原因和服务端位置校正（forcedMove）。
import { createBot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { installClientTick } from '../src/body/bot.js';

const { pathfinder, Movements, goals } = pathfinderPkg;

const NAME = process.argv[2] ?? 'MoveT';
const HOST = process.argv[3] ?? '127.0.0.1';
const PORT = Number(process.argv[4] ?? 25565);

const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, ...a);

const bot = createBot({
    username: NAME,
    host: HOST,
    port: PORT,
    auth: 'offline',
    version: '1.21.8',
    respawn: false,
    checkTimeoutInterval: 60000,
    hideErrors: true,
});
installClientTick(bot, { log: m => log('[tick]', m) });
bot.loadPlugin(pathfinder);
bot.on('kicked', r => log('KICKED', JSON.stringify(r)));
bot.on('error', e => log('ERROR', e?.message));
bot.on('end', r => log('END', r));

const fmt = v => `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;

// ---- 采样状态 ----
let prev = null;
let forwardTicks = 0;
let stallTicks = 0;
const stalls = [];
let forced = 0;
const resets = [];
const pathUpdates = [];

function blockName(p) {
    const b = bot.blockAt(p);
    return b ? b.name : 'null';
}

function describeStall(p, yaw) {
    const fx = Math.floor(p.x),
        fy = Math.floor(p.y),
        fz = Math.floor(p.z);
    const cells = [];
    for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++)
            for (let dy = 0; dy <= 1; dy++) {
                if (!dx && !dz) continue;
                const b = bot.blockAt(p.offset(dx, dy, dz), false);
                if (b && b.boundingBox === 'block') cells.push(`${b.name}@${dx},${dy},${dz}`);
            }
    const diagCorner = [];
    for (const [dx, dz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
    ]) {
        const a = bot.blockAt(p.offset(dx, 0, dz), false),
            bx = bot.blockAt(p.offset(dx, 0, 0), false),
            bz = bot.blockAt(p.offset(0, 0, dz), false);
        if (a && a.boundingBox === 'block' && bx && bx.boundingBox === 'block' && bz && bz.boundingBox === 'block')
            diagCorner.push(`${dx},${dz}`);
    }
    return {
        cell: `${fx},${fy},${fz}`,
        fracInCell: `x=${(p.x - fx).toFixed(2)} z=${(p.z - fz).toFixed(2)}`,
        yawDeg: ((yaw * 180) / Math.PI).toFixed(0),
        onGround: bot.entity.onGround,
        collided: bot.entity.isCollidedHorizontally,
        solids: cells.slice(0, 8),
        diagCorners: diagCorner,
    };
}

let verboseLeft = 0;
let verboseDone = false;

bot.on('physicsTick', () => {
    const p = bot.entity.position;
    if (!prev) {
        prev = p.clone();
        return;
    }
    const d = Math.hypot(p.x - prev.x, p.z - prev.z);
    const fwd = bot.getControlState('forward');
    if (fwd) {
        forwardTicks++;
        if (d < 0.02) {
            if (stallTicks === 0) stalls.push({ ...describeStall(p, bot.entity.yaw), startTick: forwardTicks });
            stallTicks++;
        } else if (stallTicks > 0) {
            stalls[stalls.length - 1].ticks = stallTicks;
            stallTicks = 0;
        }
    } else if (stallTicks > 0) {
        stalls[stalls.length - 1].ticks = stallTicks;
        stallTicks = 0;
    }
    // 一旦"按着前进却纹丝不动"持续 20 tick，抓 60 tick 的逐帧细节
    if (!verboseDone && stallTicks === 20) {
        verboseDone = true;
        verboseLeft = 60;
        log('==== VERBOSE TRACE START ====');
    }
    if (verboseLeft > 0) {
        verboseLeft--;
        const c = k => (bot.getControlState(k) ? k[0].toUpperCase() : '-');
        log(
            `t y=${p.y.toFixed(3)} xz=${p.x.toFixed(3)},${p.z.toFixed(3)} ` +
                `d=${d.toFixed(3)} onGround=${bot.entity.onGround} vy=${bot.entity.velocity.y.toFixed(3)} ` +
                `vel=${bot.entity.velocity.x.toFixed(2)},${bot.entity.velocity.z.toFixed(2)} ` +
                `ctrl=${c('forward')}${c('jump')}${c('sprint')} collided=${bot.entity.isCollidedHorizontally} ` +
                `moving=${bot.pathfinder?.isMoving?.()} ` +
                `feet=${blockName(p)} below=${blockName(p.offset(0, -0.5, 0))} ahead=${blockName(p.offset(0, 0, -0.7))}`,
        );
        if (verboseLeft === 0) log('==== VERBOSE TRACE END ====');
    }
    prev = p.clone();
});

bot.on('forcedMove', () => {
    forced++;
});

// 抓服务端下发的位置包，看它在"纠正"什么（横向还是纵向、多大幅度）
const corr = [];
let lastKnown = null;
let confirmWrites = 0;
const rawWrite = bot._client.write.bind(bot._client);
bot._client.write = (name, data) => {
    if (name === 'teleport_confirm') confirmWrites++;
    return rawWrite(name, data);
};
bot._client.on('position', p => {
    const now = bot.entity.position;
    const d = lastKnown
        ? { dx: +(now.x - lastKnown.x).toFixed(3), dy: +(now.y - lastKnown.y).toFixed(3), dz: +(now.z - lastKnown.z).toFixed(3) }
        : null;
    if (corr.length < 400) corr.push({ d, y: +now.y.toFixed(3), onGround: bot.entity.onGround, tid: p.teleportId, fl: p.flags?._value });
});
bot.on('physicsTick', () => {
    lastKnown = bot.entity.position.clone();
});

bot.on('path_reset', reason => {
    resets.push({ reason, at: fmt(bot.entity.position), fwdTicks: forwardTicks });
});

bot.on('path_update', r => {
    pathUpdates.push({ status: r.status, nodes: r.path ? r.path.length : 0 });
});

const sleep = ms => new Promise(r => setTimeout(r, ms));

function standable(x, y, z) {
    const below = bot.blockAt(new Vec3(x, y - 1, z), false);
    const feet = bot.blockAt(new Vec3(x, y, z), false);
    const head = bot.blockAt(new Vec3(x, y + 1, z), false);
    const air = b => b && b.boundingBox === 'empty';
    return below && below.boundingBox === 'block' && air(feet) && air(head);
}

async function run(label, gx, gy, gz) {
    const before = {
        stalls: stalls.length,
        resets: resets.length,
        forced,
        fwd: forwardTicks,
    };
    const t = Date.now();
    let status = 'ok';
    try {
        await Promise.race([
            bot.pathfinder.goto(new goals.GoalNear(gx, gy, gz, 1)),
            sleep(30000).then(() => {
                throw new Error('timeout-30s');
            }),
        ]);
    } catch (e) {
        status = e?.message ?? String(e);
    }
    const dt = Date.now() - t;
    const p = bot.entity.position;
    return {
        label,
        goal: `${gx},${gy},${gz}`,
        status,
        ms: dt,
        end: fmt(p),
        distLeft: Math.hypot(p.x - gx, p.z - gz).toFixed(2),
        newStalls: stalls.length - before.stalls,
        stallTicks: stalls.slice(before.stalls).reduce((s, x) => s + (x.ticks ?? 0), 0),
        forwardTicks: forwardTicks - before.fwd,
        resets: resets.slice(before.resets).map(r => r.reason),
        forcedMoves: forced - before.forced,
    };
}

bot.once('spawn', async () => {
    try {
        await bot.waitForChunksToLoad?.();
    } catch {}
    await sleep(1500);
    const p = bot.entity.position;
    log('spawn at', fmt(p), 'version', bot.version, 'gameMode', bot.game.gameMode);

    const m = new Movements(bot);
    m.canDig = false;
    m.allowParkour = false;
    m.maxDropDown = 3;
    m.allowSprinting = true;
    bot.pathfinder.setMovements(m);

    // 选一个 8-12 格外、站得住的目标
    const dirs = [
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
        [-1, 0],
    ];
    const results = [];
    for (const [dx, dz] of dirs) {
        let goalPos = null;
        for (let r = 12; r >= 6 && !goalPos; r--) {
            const gx = Math.floor(p.x) + dx * r + 0.5,
                gz = Math.floor(p.z) + dz * r + 0.5;
            for (let gy = Math.floor(p.y) + 2; gy >= Math.floor(p.y) - 4; gy--)
                if (standable(gx, gy, gz)) {
                    goalPos = [gx, gy, gz];
                    break;
                }
        }
        if (!goalPos) {
            log('no standable goal for dir', dx, dz);
            continue;
        }
        const r = await run(`dir ${dx},${dz}`, ...goalPos);
        results.push(r);
        log('run', JSON.stringify(r));
        if (r.distLeft < 1.5) continue;
    }

    log('==== SUMMARY ====');
    log('runs', results.length, 'bytes');
    log(
        'stall episodes',
        stalls.length,
        'total stalled ticks',
        stalls.reduce((s, x) => s + (x.ticks ?? 0), 0),
        'forward ticks',
        forwardTicks,
    );
    log('path resets', JSON.stringify(resets.map(r => r.reason)));
    log('path updates', JSON.stringify(pathUpdates.slice(0, 20)));
    log('forcedMoves (server correction)', forced);
    if (corr.length) {
        const withD = corr.filter(c => c.d);
        const abs = k => withD.map(c => Math.abs(c.d[k]));
        const stat = k => {
            const a = abs(k);
            if (!a.length) return 'n/a';
            const sum = a.reduce((s, v) => s + v, 0);
            return `mean=${(sum / a.length).toFixed(3)} max=${Math.max(...a).toFixed(3)}`;
        };
        log('corrections', withD.length, 'dx', stat('dx'), 'dy', stat('dy'), 'dz', stat('dz'));
        log('onGround@correction', withD.filter(c => c.onGround).length, '/', withD.length);
        log('teleportIds', JSON.stringify(corr.map(c => c.tid).slice(0, 40)));
        log('teleport_confirm writes', confirmWrites);
        log('first corrections', JSON.stringify(withD.slice(0, 8)));
    }
    log('---- stall details ----');
    stalls.slice(0, 5).forEach((s, i) => log(i, JSON.stringify(s)));
    const sp = bot.entity.position;
    log('---- blocks around final pos ----');
    for (let dy = -1; dy <= 2; dy++) {
        const row = [];
        for (let dx = -2; dx <= 2; dx++) {
            const b = bot.blockAt(sp.offset(dx, dy, 0), false);
            row.push(`${dx}:${b ? b.name : '?'}:${b ? b.boundingBox : '?'}`);
        }
        log(`dy=${dy}`, row.join(' | '));
    }
    bot.quit();
    setTimeout(() => process.exit(0), 500);
});
