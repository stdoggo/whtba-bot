const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { isReactionAuthorAllowed } = require('../src/settings/bot-reactions');
const { isReactionChannelAllowed } = require('../src/settings/reaction-channels');

const selfId = '123456789012345670';
const botId = '123456789012345671';
const humanId = '123456789012345672';
const guildId = '123456789012345673';
const channelId = '123456789012345674';
const otherChannelId = '123456789012345675';

test('bot reaction toggle defaults to disabled and requires explicit true', () => {
  const otherBot = { id: botId, bot: true };
  assert.equal(isReactionAuthorAllowed(otherBot, selfId), false);
  assert.equal(isReactionAuthorAllowed(otherBot, selfId, { reactToBots: false }), false);
  assert.equal(isReactionAuthorAllowed(otherBot, selfId, { reactToBots: true }), true);
  assert.equal(isReactionAuthorAllowed(otherBot, selfId, { reactToBots: 'yes' }), false);
});

test('human authors are unchanged, self messages are excluded even when enabled', () => {
  assert.equal(isReactionAuthorAllowed({ id: humanId, bot: false }, selfId, {}), true);
  assert.equal(isReactionAuthorAllowed({ id: selfId, bot: true }, selfId, { reactToBots: true }), false);
  assert.equal(isReactionAuthorAllowed({ id: selfId, bot: false }, selfId, { reactToBots: true }), false);
  assert.equal(isReactionAuthorAllowed(null, selfId, { reactToBots: true }), false);
});

test('enabled bot posts still obey the /select-channels reaction allowlist', () => {
  const settings = { reactToBots: true, reactionChannelIds: [channelId] };
  assert.equal(isReactionAuthorAllowed({ id: botId, bot: true }, selfId, settings), true);
  assert.equal(isReactionChannelAllowed(settings, channelId), true);
  assert.equal(isReactionChannelAllowed(settings, otherChannelId), false);
});

// Dependency mocks exercise processMessage without logging into Discord or PostgreSQL.
test('other bots receive initial reactions for qualifying media only when enabled', async () => {
  const stubs = {
    '../src/utils': { isValidEnvironment: async () => ({}), processInitialReactions: async m => { m.reactionCalls++; } },
    '../src/queries/get-server-settings': { getServerSettings: async () => ({ settings: currentSettings }) },
    '../src/queries/get-channel-settings': { getChannelSettings: async () => ({ settings: { allowEmbedReactions: 0, isTextForbidden: false } }) },
    '../src/queries/get-user-local': { getUserLocal: async () => ({ id: botId }) },
    '../src/queries/register-message': { registerMessage: () => { registered++; } },
    '../src/queries/create-user': { createUser: async () => ({}) },
  };
  let currentSettings = { reactToBots: false, reactionChannelIds: [channelId], allowEmbedReactions: 0 };
  let registered = 0;
  for (const [relative, exports] of Object.entries(stubs)) {
    const file = require.resolve(relative);
    require.cache[file] = { id: file, filename: file, loaded: true, exports };
  }
  const { processMessage } = require('../src/handlers/message');
  const client = { user: { id: selfId } };
  const makeMessage = (author, attachments = true) => ({
    id: '123456789012345676', guild: { id: guildId, name: 'Server' },
    channel: { id: channelId, name: 'photos' },
    author, embeds: [], content: 'hello', reactionCalls: 0,
    attachments: { first: () => attachments ? { url: 'https://cdn.discordapp.com/x.png' } : undefined,
      forEach: callback => attachments ? callback({ url: 'https://cdn.discordapp.com/x.png', name: 'x.png', contentType: 'image/png' }) : undefined },
  });
  const otherBot = { id: botId, username: 'OtherBot', bot: true };
  let message = makeMessage(otherBot);
  await processMessage(client, message, {});
  assert.equal(message.reactionCalls, 0);
  assert.equal(registered, 0);
  currentSettings = { ...currentSettings, reactToBots: true };
  message = makeMessage(otherBot);
  await processMessage(client, message, {});
  assert.equal(message.reactionCalls, 1);
  assert.equal(registered, 1);
  message = makeMessage({ id: selfId, username: 'WHTBA', bot: true });
  await processMessage(client, message, {});
  assert.equal(message.reactionCalls, 0);
  assert.equal(registered, 1);
  message = makeMessage(otherBot, false);
  await processMessage(client, message, {});
  assert.equal(message.reactionCalls, 0);
  assert.equal(registered, 1);
  currentSettings = { ...currentSettings, reactionChannelIds: [otherChannelId] };
  message = makeMessage(otherBot);
  await processMessage(client, message, {});
  assert.equal(message.reactionCalls, 0);
  assert.equal(registered, 1);
  currentSettings = { ...currentSettings, reactToBots: false, reactionChannelIds: [channelId] };
  message = makeMessage({ id: humanId, username: 'Human', bot: false });
  await processMessage(client, message, {});
  assert.equal(message.reactionCalls, 1);
  assert.equal(registered, 2);
});
