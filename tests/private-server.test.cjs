const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');

test('event routing processes only the configured private server, without logging in on import', async () => {
  const guild = '123456789012345678';
  process.env.DISCORD_GUILD_ID = guild;
  const calls = [];
  for (const [module, name] of [['message', 'processMessage'], ['command', 'processCommand'], ['reactions', 'processReaction'], ['load', 'processLoad']]) {
    const filename = require.resolve(`../src/handlers/${module}`);
    require.cache[filename] = { id: filename, filename, loaded: true, exports: {
      [name]: async (...args) => { calls.push({ name, args }); }
    } };
  }
  const { Client, Events } = require('discord.js');
  const originalLogin = Client.prototype.login;
  let logins = 0;
  Client.prototype.login = async () => { logins++; };
  const { discordClient, prismaClient } = require('../src/entry');
  try {
    for (const id of [null, '123456789012345679', guild]) {
      discordClient.emit(Events.MessageCreate, { guildId: id });
      discordClient.emit(Events.InteractionCreate, { guildId: id, isChatInputCommand: () => true });
      discordClient.emit(Events.MessageReactionAdd, { message: { guildId: id } }, {});
      discordClient.emit(Events.MessageReactionRemove, { message: { guildId: id } }, {});
    }
    assert.equal(logins, 0);
    assert.deepEqual(calls.map(call => call.name), ['processMessage', 'processCommand', 'processReaction', 'processReaction']);
    assert.equal(calls[2].args[2], true);
    assert.equal(calls[3].args[2], false);
  } finally {
    Client.prototype.login = originalLogin;
    await discordClient.destroy();
    await prismaClient.$disconnect();
  }
});
