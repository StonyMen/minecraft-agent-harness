// 临时诊断：检查右键交互（开箱/开门）为什么失败。不修改任何生产代码。
import { setSettings } from '../src/skills/settings.js';
import pf from 'mineflayer-pathfinder';

setSettings({
    host: '127.0.0.1',
    port: 25565,
    auth: 'offline',
    minecraft_version: '1.21.8',
});

const { initBot } = await import('../src/body/bot.js');
const { goals } = pf;

const NAME = process.argv[2] || 'InT';
const bot = initBot(NAME);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[probe]', ...a);

const INTERACTIVE = [
    'chest', 'trapped_chest', 'barrel', 'shulker_box', 'ender_chest',
    'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'anvil',
    'lever', 'stone_button', 'oak_button', 'spruce_button',
    'oak_door', 'spruce_door', 'birch_door', 'iron_door', 'oak_trapdoor',
    'oak_fence_gate', 'spruce_fence_gate', 'white_bed', 'red_bed',
];

const sent = [];
const rawWrite = bot._client.write.bind(bot._client);
bot._client.write = (name, params) => {
    if (name === 'block_place' || name === 'use_entity') sent.push({ name, ...(params ?? {}) });
    return rawWrite(name, params);
};

let opened = null;
bot.on('windowOpen', w => {
    opened = w;
    log('windowOpen', w.type, 'slots', w.slots?.length);
});
bot.on('blockUpdate', (oldB, newB) => {
    if (oldB?.name !== newB?.name) log('blockUpdate', newB?.name, newB?.position?.toString());
});

bot.once('spawn', async () => {
    await bot.waitForChunksToLoad();
    await sleep(1200);
    const p = bot.entity.position;
    log('spawn', p.x.toFixed(1), p.y.toFixed(1), p.z.toFixed(1));

    // 1. 附近有哪些可交互方块
    const found = [];
    for (const name of INTERACTIVE) {
        const positions = bot.findBlocks({
            matching: bot.registry.blocksByName[name]?.id,
            maxDistance: 20,
            count: 3,
        });
        for (const pos of positions) {
            const b = bot.blockAt(pos, false);
            if (b) found.push({ block: b, name, dist: b.position.distanceTo(p) });
        }
    }
    found.sort((a, b) => a.dist - b.dist);
    log('nearby interactive blocks:');
    for (const f of found.slice(0, 10)) {
        log('  ', f.name, f.block.position.toString(), 'dist', f.dist.toFixed(1));
    }
    if (!found.length) {
        log('none within 20 blocks — abort');
        bot.quit();
        setTimeout(() => process.exit(0), 300);
        return;
    }

    // 2. 走到最近的方块旁（3 格内），然后右键
    const target = found[0].block;
    log('target =', target.name, target.position.toString());
    if (target.position.distanceTo(bot.entity.position) > 3.2) {
        try {
            await Promise.race([
                bot.pathfinder.goto(
                    new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2),
                ),
                sleep(20000).then(() => {
                    throw new Error('walk timeout');
                }),
            ]);
        } catch (e) {
            log('walk failed:', e.message);
        }
    }
    log('now at', bot.entity.position.floored().toString(), 'dist',
        target.position.distanceTo(bot.entity.position).toFixed(2));

    // 3. 右键
    const beforeName = bot.blockAt(target.position, false)?.name;
    const beforeProps = JSON.stringify(bot.blockAt(target.position, false)?.getProperties?.() ?? {});
    sent.length = 0;
    try {
        await bot.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
        log('looked at target');
    } catch (e) {
        log('lookAt failed:', e.message);
    }
    await sleep(80);
    try {
        await bot.activateBlock(target);
        log('activateBlock returned ok');
    } catch (e) {
        log('activateBlock threw:', e.message);
    }
    await sleep(3000);

    log('packets sent:', JSON.stringify(sent.map(s => ({ name: s.name, ...s, at: undefined }))));
    log('windowOpen:', opened ? `${opened.type}/${opened.slots?.length}` : 'NONE');
    const after = bot.blockAt(target.position, false);
    log('block before', beforeName, beforeProps);
    log('block after ', after?.name, JSON.stringify(after?.getProperties?.() ?? {}));

    // 4. 若第一次失败，换一种方式：手工发包，sequence 递增，不做 lookAt
    if (!opened) {
        log('---- retry: manual block_place with sequence=1, no look ----');
        const { Vec3 } = await import('vec3');
        sent.length = 0;
        rawWrite('block_place', {
            hand: 0,
            location: target.position,
            direction: 1,
            cursorX: 0.5,
            cursorY: 0.5,
            cursorZ: 0.5,
            insideBlock: false,
            worldBorderHit: false,
            sequence: 1,
        });
        await sleep(2500);
        log('retry windowOpen:', opened ? opened.type : 'NONE');
        log('retry block:', bot.blockAt(target.position, false)?.name);
    }

    bot.quit();
    setTimeout(() => process.exit(0), 400);
});
