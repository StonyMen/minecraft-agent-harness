import test from 'node:test';
import assert from 'node:assert/strict';
import { installWhisperAllowance } from '../../src/body/bot.js';

test('outgoing chat is never rewritten: every character is kept', () => {
    const sent = [];
    const bot = { _client: {}, chat: message => sent.push(message), whisper: () => {} };
    const original = bot.chat;

    installWhisperAllowance(bot);

    assert.equal(bot.chat, original, 'chat must stay the raw mineflayer implementation');
    bot.chat('樱花林，你好 — café… 😀');
    assert.deepEqual(sent, ['樱花林，你好 — café… 😀']);
});

test('whisper keeps the text intact and grants the chat-guard allowance', () => {
    const sent = [];
    const bot = {
        _client: {},
        chat: () => {},
        whisper: (username, message) => sent.push(['whisper', username, message]),
    };

    installWhisperAllowance(bot);
    installWhisperAllowance(bot);

    bot.whisper('Steve', '可以，我用中文 — 这里没有树');
    assert.deepEqual(sent, [['whisper', 'Steve', '可以，我用中文 — 这里没有树']]);
    assert.equal(bot._client.pi_whisperAllowance.to, 'steve');
});
