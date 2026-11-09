// 临时诊断 v2：门/按钮 + 全量入站包监听 + 游戏模式
import { setSettings } from '../src/skills/settings.js';
import pf from 'mineflayer-pathfinder';

setSettings({ host: '127.0.0.1', port: 25565, auth: 'offline', minecraft_version: '1.21.8' });
const { initBot } = await import('../src/body/bot.js');
const { goals } = pf;

const NAME = process.argv[2] || 'InT2';
const bot = initBot(NAME);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[probe]', ...a);

const sent = [];
const rawWrite = bot._client.write.bind(bot._client);
bot._client.write = (name, params) => {
    if (name === 'block_place' || name === 'use_entity' || name === 'use_item') {
        sent.push({ name, ...(params ?? {}) });
    }
    return rawWrite(name, params);
};

const incoming = [];
let capture = false;
const rawEmit = bot._client.emit.bind(bot._client);
bot._client.emit = function (event, ...args) {
    if (capture && typeof event === 'string') {
        const info = event === 'block_update'
            ? `${event} ${args[0]?.position} ${args[0]?.name}`
            : event;
        if (incoming.length < 40) incoming.push(info);
    }
    return rawEmit(event, ...args);
};

const DOORS = ['oak_door', 'spruce_door', 'birch_door', 'jungle_door', 'acacia_door',
    'dark_oak_door', 'cherry_door', 'mangrove_door', 'iron_door', 'oak_fence_gate',
    'spruce_fence_gate', 'cherry_fence_gate', 'oak_trapdoor', 'oak_button', 'stone_button', 'lever'];

bot.once('spawn', async () => {
    await bot.waitForChunksToLoad();
    await sleep(1200);
    log('gameMode', bot.game.gameMode, '| dimension', bot.game.dimension, '| hardcore', bot.game.hardcore);
    log('health', bot.health, '| food', bot.food, '| items', bot.inventory.items().length);

    const found = [];
    for (const name of DOORS) {
        for (const pos of bot.findBlocks({ matching: bot.registry.blocksByName[name]?.id, maxDistance: 64, count: 2 })) {
            const b = bot.blockAt(pos, false);
            if (b) found.push({ block: b, name, dist: b.position.distanceTo(bot.entity.position) });
        }
    }
    found.sort((a, b) => a.dist - b.dist);
    log('doors/gates/buttons found:', found.length);
    for (const f of found.slice(0, 6)) log('  ', f.name, f.block.position.toString(), 'dist', f.dist.toFixed(1));

    if (!found.length) {
        log('no door within 64 — abort');
        bot.quit();
        setTimeout(() => process.exit(0), 300);
        return;
    }

    const target = found[0].block;
    log('target', target.name, target.position.toString());
    if (target.position.distanceTo(bot.entity.position) > 3) {
        try {
            await Promise.race([
                bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)),
                sleep(30000).then(() => { throw new Error('walk timeout'); }),
            ]);
        } catch (e) { log('walk failed', e.message); }
    }
    log('at', bot.entity.position.floored().toString(), 'dist', target.position.distanceTo(bot.entity.position).toFixed(2));

    const props = b => JSON.stringify(bot.blockAt(b.position, false)?.getProperties?.() ?? {});
    log('props before', props(target));

    sent.length = 0;
    incoming.length = 0;
    capture = true;
    await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
    await sleep(60);
    try {
        await bot.activateBlock(target);
        log('activateBlock ok');
    } catch (e) { log('activateBlock threw', e.message); }
    await sleep(2000);
    capture = false;

    log('sent', JSON.stringify(sent));
    log('incoming after interact:', JSON.stringify(incoming));
    log('props after ', props(target));

    // 若门没动，试第二个：手工包，direction 用玩家所在侧
    if (props(target) === props(target)) {
        log('---- manual retry, direction from player side ----');
        const dx = bot.entity.position.x - (target.position.x + 0.5);
        const dz = bot.entity.position.z - (target.position.z + 0.5);
        const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 5 : 4) : (dz > 0 ? 3 : 2);
        sent.length = 0;
        incoming.length = 0;
        capture = true;
        rawWrite('block_place', {
            hand: 0,
            location: target.position,
            direction: dir,
            cursorX: 0.5,
            cursorY: 0.5,
            cursorZ: 0.5,
            insideBlock: false,
            worldBorderHit: false,
            sequence: 0,
        });
        await sleep(1500);
        capture = false;
        log('manual dir', dir, 'duplicate packet: true');
        log('manual incoming:', JSON.stringify(incoming));
        log('props after manual', props(target));
    }

    bot.quit();
    setTimeout(() => process.exit(0), 400);
});
