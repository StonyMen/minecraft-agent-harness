// 临时诊断 v3：近距离开箱，监听所有入站包
import { setSettings } from '../src/skills/settings.js';
import pf from 'mineflayer-pathfinder';

setSettings({ host: '127.0.0.1', port: 25565, auth: 'offline', minecraft_version: '1.21.8' });
const { initBot } = await import('../src/body/bot.js');
const { goals } = pf;

const NAME = process.argv[2] || 'InT3';
const bot = initBot(NAME);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[probe]', ...a);

const sent = [];
const rawWrite = bot._client.write.bind(bot._client);
bot._client.write = (name, params) => {
    if (name === 'block_place') sent.push({ ...(params ?? {}) });
    return rawWrite(name, params);
};

const incoming = [];
let capture = false;
const rawEmit = bot._client.emit.bind(bot._client);
bot._client.emit = function (event, ...args) {
    if (capture && typeof event === 'string' && !event.startsWith('raw') && event !== 'packet') {
        const extra = event.includes('block') || event.includes('ack')
            ? ' ' + JSON.stringify(args[0]?.position ?? args[0]?.sequence ?? args[0] ?? '')
            : '';
        if (incoming.length < 30) incoming.push(event + extra);
    }
    return rawEmit(event, ...args);
};

let opened = null;
bot.on('windowOpen', w => { opened = w; });

bot.once('spawn', async () => {
    await bot.waitForChunksToLoad();
    await sleep(1200);
    log('gameMode', bot.game.gameMode, '| at', bot.entity.position.floored().toString());

    const NAMES = ['chest', 'trapped_chest', 'barrel', 'crafting_table', 'furnace'];
    const cands = [];
    for (const name of NAMES) {
        for (const pos of bot.findBlocks({ matching: bot.registry.blocksByName[name]?.id, maxDistance: 16, count: 3 })) {
            const b = bot.blockAt(pos, false);
            if (b) cands.push({ b, name, dist: b.position.distanceTo(bot.entity.position) });
        }
    }
    cands.sort((a, b) => a.dist - b.dist);
    log('candidates:', cands.slice(0, 5).map(c => `${c.name}@${c.b.position} d=${c.dist.toFixed(1)}`).join(' | '));
    if (!cands.length) { log('none'); bot.quit(); setTimeout(() => process.exit(0), 300); return; }

    const target = cands[0].b;
    if (target.position.distanceTo(bot.entity.position) > 3) {
        try {
            await Promise.race([
                bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)),
                sleep(25000).then(() => { throw new Error('timeout'); }),
            ]);
        } catch (e) { log('walk', e.message); }
    }
    const dist = target.position.distanceTo(bot.entity.position);
    log('target', target.name, target.position.toString(), 'dist', dist.toFixed(2));
    if (dist > 4.4) { log('still too far, abort'); bot.quit(); setTimeout(() => process.exit(0), 300); return; }

    sent.length = 0;
    incoming.length = 0;
    capture = true;
    await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
    await sleep(100);
    try { await bot.activateBlock(target); log('activateBlock ok'); }
    catch (e) { log('activateBlock threw', e.message); }
    await sleep(2500);
    capture = false;

    log('SENT', JSON.stringify(sent));
    log('INCOMING', JSON.stringify(incoming));
    log('WINDOW', opened ? `${opened.type}/${opened.slots?.length}` : 'NONE');

    bot.quit();
    setTimeout(() => process.exit(0), 400);
});
