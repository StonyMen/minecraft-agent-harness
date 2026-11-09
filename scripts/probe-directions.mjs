// 方向对照：在同一个点上分别按 前进/后退/左/右/斜前左，看哪一档会触发服务端传送风暴。
// 用来验证"斜角撞方块才是触发点"这个假设。
import settings, { setSettings } from '../src/skills/settings.js';

setSettings({ minecraft_version: '1.21.8', host: '127.0.0.1', port: 25565, auth: 'offline' });
const { initBot } = await import('../src/body/bot.js');

const NAME = process.argv[2] ?? 'IdleT';
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const bot = initBot(NAME);
let forced = 0;
bot.on('forcedMove', () => forced++);
bot.on('error', e => log('ERROR', e?.message));

bot.once('spawn', async () => {
    await sleep(1800);
    const p = bot.entity.position.clone();
    log('spawn', `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`, 'onGround', bot.entity.onGround);
    const f = Math.floor(p.x),
        fy = Math.floor(p.y),
        fz = Math.floor(p.z);
    for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ]) {
        const b = bot.blockAt(new (p.constructor)(f + dx, fy + 1, fz + dz), false);
        const c = bot.blockAt(new (p.constructor)(f + dx, fy, fz + dz), false);
        if (dx || dz) log(`邻居 ${dx},${dz}: 脚=${c?.name}/${c?.boundingBox} 头=${b?.name}/${b?.boundingBox}`);
    }

    for (const combo of [
        ['forward'],
        ['back'],
        ['left'],
        ['right'],
        ['forward', 'left'],
        ['jump'],
    ]) {
        const s = bot.entity.position.clone();
        const before = forced;
        for (const c of combo) bot.setControlState(c, true);
        await sleep(4000);
        for (const c of combo) bot.setControlState(c, false);
        await sleep(300);
        const end = bot.entity.position;
        log(
            combo.join('+'),
            JSON.stringify({
                forcedMoves: forced - before,
                moved: +s.distanceTo(end).toFixed(2),
                dy: +(end.y - s.y).toFixed(2),
                end: `${end.x.toFixed(2)},${end.y.toFixed(2)},${end.z.toFixed(2)}`,
            }),
        );
    }
    bot.quit();
    setTimeout(() => process.exit(0), 300);
});
