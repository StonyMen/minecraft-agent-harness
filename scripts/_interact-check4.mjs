// 临时诊断 v4：两个 bot 互相观察 —— 判断右键包到底有没有到达服务端
// A 在箱子旁右键；B 旁观，看服务端是否广播了 A 的手臂挥动（swingArm）
import { setSettings } from '../src/skills/settings.js';
import pf from 'mineflayer-pathfinder';

setSettings({ host: '127.0.0.1', port: 25565, auth: 'offline', minecraft_version: '1.21.8' });
const { initBot } = await import('../src/body/bot.js');
const { goals } = pf;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[probe]', ...a);

const a = initBot('InT4');
const b = initBot('Obs1');

const swings = [];
const seen = [];
b.on('entitySwingArm', e => {
    swings.push(`${e.username ?? e.name ?? e.id}@${Date.now() % 100000}`);
});
b.on('entityMoved', e => {
    if (seen.length < 5 && e.username) seen.push(e.username);
});

let windowOpened = false;
a.on('windowOpen', w => {
    windowOpened = true;
    log('A windowOpen', w.type, w.slots?.length);
});

const sentPackets = [];
const rawA = a._client.write.bind(a._client);
a._client.write = (name, params) => {
    if (name === 'block_place') sentPackets.push(Date.now() % 100000);
    return rawA(name, params);
};

let ready = 0;
const spawned = who =>
    new Promise(res => {
        who.once('spawn', async () => {
            await who.waitForChunksToLoad();
            res();
        });
    });

await Promise.all([spawned(a), spawned(b)]);
await sleep(1200);

// B 先报告能看到谁
log('B sees entities:', Object.values(b.entities).filter(e => e.username).map(e => e.username).join(',') || '(none)');

// A 找箱子并走过去
const chestId = a.registry.blocksByName.chest.id;
const cands = a
    .findBlocks({ matching: chestId, maxDistance: 16, count: 5 })
    .map(p => a.blockAt(p, false))
    .filter(Boolean)
    .sort((x, y) => x.position.distanceTo(a.entity.position) - y.position.distanceTo(a.entity.position));

if (!cands.length) {
    log('no chest nearby');
    process.exit(0);
}
const target = cands[0];
log('A target chest', target.position.toString(), 'dist', target.position.distanceTo(a.entity.position).toFixed(1));
if (target.position.distanceTo(a.entity.position) > 3) {
    try {
        await Promise.race([
            a.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2)),
            sleep(25000).then(() => { throw new Error('timeout'); }),
        ]);
    } catch (e) { log('A walk', e.message); }
}
log('A at', a.entity.position.floored().toString(), 'dist', target.position.distanceTo(a.entity.position).toFixed(2));

// 等 B 看到 A
await sleep(800);
log('B sees A?', Object.values(b.entities).some(e => e.username === 'InT4'));

swings.length = 0;
sentPackets.length = 0;
await a.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
await sleep(100);
log('--- A activates block ---');
try { await a.activateBlock(target); log('A activateBlock ok'); } catch (e) { log('A threw', e.message); }
await sleep(2500);

log('A sent block_place count:', sentPackets.length);
log('B saw swings:', JSON.stringify(swings));
log('A windowOpen:', windowOpened);

// 对照：A 空手挥臂（直接 swingArm），B 应该能看到
swings.length = 0;
a.swingArm();
await sleep(1200);
log('control: after plain swingArm, B saw swings:', JSON.stringify(swings));

a.quit();
b.quit();
setTimeout(() => process.exit(0), 500);
