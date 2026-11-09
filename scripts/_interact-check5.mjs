// 临时诊断 v5：对照挖掘（block_dig）与右键（block_place）是否都能到达服务端
import { setSettings } from '../src/skills/settings.js';
import pf from 'mineflayer-pathfinder';

setSettings({ host: '127.0.0.1', port: 25565, auth: 'offline', minecraft_version: '1.21.8' });
const { initBot } = await import('../src/body/bot.js');
const { goals } = pf;
const { Vec3 } = await import('vec3');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[probe]', ...a);

const bot = initBot(process.argv[2] || 'InT5');

const updates = [];
bot.on('blockUpdate', (oldB, newB) => {
    if (updates.length < 20) updates.push(`${newB?.position}=${newB?.name}`);
});

bot.once('spawn', async () => {
    await bot.waitForChunksToLoad();
    await sleep(1000);

    // ---- 1. 挖方块 ----
    const digNames = ['dirt', 'grass_block', 'sand', 'gravel', 'oak_leaves', 'short_grass'];
    let digTarget = null;
    for (const n of digNames) {
        const id = bot.registry.blocksByName[n]?.id;
        if (id === undefined) continue;
        const pos = bot.findBlocks({ matching: id, maxDistance: 32, count: 4 });
        for (const p of pos) {
            const b = bot.blockAt(p, false);
            if (b && b.name !== 'air') { digTarget = b; break; }
        }
        if (digTarget) break;
    }
    if (!digTarget) { log('no diggable block'); bot.quit(); setTimeout(() => process.exit(0), 300); return; }
    log('dig target', digTarget.name, digTarget.position.toString());

    if (digTarget.position.distanceTo(bot.entity.position) > 2.5) {
        try {
            await Promise.race([
                bot.pathfinder.goto(new goals.GoalNear(digTarget.position.x, digTarget.position.y, digTarget.position.z, 2)),
                sleep(30000).then(() => { throw new Error('timeout'); }),
            ]);
        } catch (e) { log('walk', e.message); }
    }
    updates.length = 0;
    const digPos = digTarget.position.clone();
    let digOk = false;
    try {
        await bot.dig(digTarget, true);
        log('dig returned');
    } catch (e) { log('dig threw', e.message); }
    await sleep(2500);
    const after = bot.blockAt(digPos, false);
    digOk = after?.name === 'air' || !after;
    log('DIG result:', digOk ? 'SUCCESS' : 'FAILED', '->', after?.name);
    log('blockUpdates:', JSON.stringify(updates.slice(0, 8)));
    log('inventory:', bot.inventory.items().map(i => `${i.name}x${i.count}`).join(',') || 'empty');

    // ---- 2. 右键箱子 ----
    const chestId = bot.registry.blocksByName.chest.id;
    const chests = bot
        .findBlocks({ matching: chestId, maxDistance: 20, count: 5 })
        .map(p => bot.blockAt(p, false))
        .filter(Boolean)
        .sort((x, y) => x.position.distanceTo(bot.entity.position) - y.position.distanceTo(bot.entity.position));
    if (!chests.length) { log('no chest'); bot.quit(); setTimeout(() => process.exit(0), 300); return; }
    const chest = chests[0];
    if (chest.position.distanceTo(bot.entity.position) > 3) {
        try {
            await Promise.race([
                bot.pathfinder.goto(new goals.GoalNear(chest.position.x, chest.position.y, chest.position.z, 2)),
                sleep(25000).then(() => { throw new Error('timeout'); }),
            ]);
        } catch (e) { log('walk to chest', e.message); }
    }
    log('chest', chest.position.toString(), 'dist', chest.position.distanceTo(bot.entity.position).toFixed(2));

    let opened = null;
    bot.on('windowOpen', w => { opened = w; });
    updates.length = 0;
    await bot.lookAt(chest.position.offset(0.5, 0.5, 0.5), true);
    await sleep(100);
    try { await bot.activateBlock(chest); log('activateBlock returned'); } catch (e) { log('activate threw', e.message); }
    await sleep(2500);
    log('PLACE/open result:', opened ? `window ${opened.type}` : 'NO WINDOW');
    log('blockUpdates after right click:', JSON.stringify(updates.slice(0, 8)));

    bot.quit();
    setTimeout(() => process.exit(0), 400);
});
