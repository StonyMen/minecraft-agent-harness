// 顶墙对照：找一格正前方的实心方块，按住前进 4 秒，统计服务端传送次数与位移。
// 顺便记录每个 position 包里的 dx/dy/dz 与标志位，用来判断"服务端想给你什么速度"。
import { setSettings } from '../src/skills/settings.js';

setSettings({ minecraft_version: '1.21.8', host: '127.0.0.1', port: 25565, auth: 'offline' });
const { initBot } = await import('../src/body/bot.js');

const NAME = process.argv[2] ?? 'WallT';
const ROUNDS = Number(process.argv[3] ?? 3);
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const bot = initBot(NAME);
let forced = 0;
let packets = [];
let lastPos = null;
const deltas = [];

bot.on('forcedMove', () => forced++);
bot.on('error', e => log('ERROR', e?.message));
bot.on('kicked', r => log('KICKED', typeof r === 'string' ? r : JSON.stringify(r)));

bot._client.on('position', p => {
    const now = bot.entity.position;
    if (lastPos) {
        deltas.push({
            d: +Math.hypot(now.x - lastPos.x, now.z - lastPos.z).toFixed(3),
            v: [+(p.dx ?? 0).toFixed(3), +(p.dy ?? 0).toFixed(3), +(p.dz ?? 0).toFixed(3)],
            f: p.flags,
        });
    }
    lastPos = now.clone();
    packets.push(p);
});

const DIRS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
];

// 在自身脚踩的高度上，找最近的实心方块（且它脚下两格是空的，说明是"墙"而不是台阶）
function findWall(maxR = 8) {
    const p = bot.entity.position;
    for (let r = 1; r <= maxR; r++) {
        for (const [dx, dz] of DIRS) {
            const low = bot.blockAt(p.offset(dx * r, 0, dz * r), false);
            const high = bot.blockAt(p.offset(dx * r, 1, dz * r), false);
            // 两格高的实心墙，且挡在它前面那一格是能站的
            if (!low || low.boundingBox !== 'block') continue;
            if (!high || high.boundingBox !== 'block') continue;
            if (r > 1) {
                const front = bot.blockAt(p.offset(dx * (r - 1), 0, dz * (r - 1)), false);
                const frontHead = bot.blockAt(p.offset(dx * (r - 1), 1, dz * (r - 1)), false);
                if (!front || front.boundingBox !== 'empty') continue;
                if (!frontHead || frontHead.boundingBox !== 'empty') continue;
            }
            return { yaw: Math.atan2(-dx, -dz), dx, dz, r, name: low.name };
        }
    }
    return null;
}

async function searchWall() {
    for (let i = 0; i < 10; i++) {
        const w = findWall(10);
        if (w) return w;
        bot.setControlState('forward', true);
        bot.setControlState('jump', true);
        await sleep(1200);
    }
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    return null;
}

bot.once('spawn', async () => {
    await sleep(1800);
    const p = bot.entity.position;
    log('spawn', `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`, 'onGround', bot.entity.onGround);

    const target = await searchWall();
    bot.setControlState('forward', false);
    bot.setControlState('jump', false);
    await sleep(400);
    log('wall', target ? JSON.stringify(target) : '无（做空地对照）');
    log('at', bot.entity.position.toArray().map(v => +v.toFixed(2)).join(','));

    for (let i = 0; i < ROUNDS; i++) {
        if (target) bot.look(target.yaw, 0, true);
        await sleep(250);
        const start = bot.entity.position.clone();
        const before = forced;
        const beforePk = packets.length;
        deltas.length = 0;
        bot.setControlState('forward', true);
        await sleep(4000);
        bot.setControlState('forward', false);
        await sleep(300);
        const end = bot.entity.position;
        const nonZero = deltas.filter(d => d.v.some(v => Math.abs(v) > 0.0001));
        log(
            'ROUND',
            JSON.stringify({
                i,
                forced: forced - before,
                posPackets: packets.length - beforePk,
                nonZeroDelta: nonZero.length,
                sample: nonZero.slice(0, 2),
                moved: +start.distanceTo(end).toFixed(2),
            }),
        );
        await sleep(600);
    }
    // 斜着顶墙：原版会被挡住一个轴、沿切向滑出去；如果这一步滑不动，拐角就还是死结
    if (target) {
        bot.look(target.yaw, 0, true);
        await sleep(250);
        const s2 = bot.entity.position.clone();
        const before2 = forced;
        bot.setControlState('forward', true);
        bot.setControlState('left', true);
        await sleep(3000);
        bot.setControlState('forward', false);
        bot.setControlState('left', false);
        await sleep(300);
        log('SLIDE', JSON.stringify({ forced: forced - before2, moved: +s2.distanceTo(bot.entity.position).toFixed(2) }));
    }

    bot.quit();
    setTimeout(() => process.exit(0), 300);
});
