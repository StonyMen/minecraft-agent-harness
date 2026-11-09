// 基线对照：站着不动 8 秒，看服务端到底有没有在主动下发 position 包。
// 用来区分"传送风暴是移动引起的"还是"这条版本链本身就在不停发包"。
import settings, { setSettings } from '../src/skills/settings.js';

setSettings({ minecraft_version: '1.21.8', host: '127.0.0.1', port: 25565, auth: 'offline' });
const { initBot } = await import('../src/body/bot.js');

const NAME = process.argv[2] ?? 'IdleT';
const t0 = Date.now();
const log = (...a) => console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, ...a);

const bot = initBot(NAME);
let forced = 0;
let last = null;
const gaps = [];
bot.on('forcedMove', () => {
    forced++;
    const now = Date.now();
    if (last) gaps.push(now - last);
    last = now;
});
bot.on('error', e => log('ERROR', e?.message));

bot.once('spawn', async () => {
    await sleep(1500);
    const p = bot.entity.position.clone();
    log('spawn', `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`);
    const before = forced;
    await sleep(8000);
    log('idle 8s → forcedMoves', forced - before, 'p95 gap ms', gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.95)] : 'n/a');
    log('moved while idle', bot.entity.position.distanceTo(p).toFixed(3));

    // 再按住前进 8 秒，对比
    const f0 = forced;
    const s = bot.entity.position.clone();
    bot.setControlState('forward', true);
    await sleep(8000);
    bot.setControlState('forward', false);
    log('walk 8s → forcedMoves', forced - f0, 'moved', bot.entity.position.distanceTo(s).toFixed(2));
    bot.quit();
    setTimeout(() => process.exit(0), 300);
});

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}
