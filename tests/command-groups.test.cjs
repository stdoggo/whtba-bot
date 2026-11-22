const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
// Importing commands also imports entry/private-server; use a harmless test-only guild ID.
process.env.DISCORD_GUILD_ID = '123456789012345678';
const { ApplicationCommandOptionType } = require('discord.js');
const { Commands } = require('../src/constants');

const groups = Object.fromEntries(Commands.map(command => [command.name, command]));
const findSub = (group, name) => groups[group].options.find(item => item.name === name);

test('only the three top-level slash commands are published', () => {
  assert.deepEqual(Commands.map(command => command.name).sort(), ['embed','reaction','stats']);
  assert.equal(Commands.every(command => command.options.every(option =>
    option.type === ApplicationCommandOptionType.Subcommand)), true);
});

test('reaction settings include guild, per-channel embed reactions and multi-channel picker', () => {
  assert.deepEqual(groups['reaction'].options.map(option => option.name),
    ['server','channel','channels','show']);
  for (const option of ['like-reaction','dislike-reaction','react-to-bots','allow-embed-reactions']) {
    assert.ok(findSub('reaction','server').options.some(o => o.name === option));
  }
  assert.ok(findSub('reaction','channel').options.some(o => o.name === 'allow-embed-reactions'));
});

test('embed settings include preview filters and per-channel media moderation', () => {
  assert.deepEqual(groups['embed'].options.map(option => option.name),
    ['preview','moderation','show']);
  for (const name of ['action','enabled','channel']) {
    assert.ok(findSub('embed','preview').options.some(o => o.name === name));
  }
  assert.ok(findSub('embed','moderation').options.some(o => o.name === 'forbid-text'));
  const actions = findSub('embed','preview').options.find(o => o.name === 'action').choices.map(c => c.value);
  assert.ok(actions.includes('message-links'));
});

test('legacy command names are not registered', () => {
  for (const retired of ['help','setupserver','setupchannel','settings','select-channels','embed-settings','reaction-settings']) {
    assert.equal(Commands.some(command => command.name === retired), false);
  }
});

test('stats command is open to members, settings commands stay admin-only', () => {
  assert.deepEqual(groups.stats.options.map(option => option.name),
    ['server','user','leaderboard','channels','top-days','sync']);
  assert.equal(groups.stats.adminOnly, false);
  assert.equal(groups['embed'].adminOnly, undefined);
  assert.equal(groups['reaction'].adminOnly, undefined);
  for (const sub of ['server','user']) {
    for (const name of ['interval','range','from','to','channel']) {
      assert.ok(findSub('stats', sub).options.some(o => o.name === name), sub + ' ' + name);
    }
  }
  const fake = (sub, priv) => ({ options: { getSubcommand: () => sub, getBoolean: () => priv } });
  assert.equal(groups.stats.ephemeral(fake('server', null)), false);
  assert.equal(groups.stats.ephemeral(fake('server', true)), true);
  assert.equal(groups.stats.ephemeral(fake('sync', null)), true);
  for (const command of Commands) {
    assert.ok(command.description.length <= 100);
    for (const sub of command.options) {
      assert.ok(sub.description.length <= 100, sub.name);
      for (const option of sub.options ?? []) assert.ok(option.description.length <= 100, sub.name + ' ' + option.name);
    }
  }
});

test('days, leaderboard and channels share the same paginated buttons', () => {
  const stats = require('../src/commands/stats');
  for (const sub of ['top-days', 'leaderboard', 'channels']) {
    assert.ok(findSub('stats', sub).options.some(o => o.name === 'page'), sub);
    assert.ok(!findSub('stats', sub).options.some(o => o.name === 'limit'), sub);
  }
  assert.equal(stats.pageCount(0), 1);
  assert.equal(stats.pageCount(20), 1);
  assert.equal(stats.pageCount(21), 2);
  assert.equal(stats.rankPrefix(1, 50), '🥇');
  assert.equal(stats.rankPrefix(3, 50), '🥉');
  assert.equal(stats.rankPrefix(4, 50), '` 4.`');
  assert.equal(stats.rankPrefix(4, 5), '`4.`');

  const snowflake = '12345678901234567890';
  const states = [
    { kind: 'days', page: 9999, range: 'all', channelId: snowflake, userId: snowflake, includeBots: true, ownerId: snowflake },
    { kind: 'users', page: 9999, range: 'd99999-99999', channelId: snowflake, userId: null, includeBots: false, ownerId: snowflake },
    { kind: 'channels', page: 3, range: 'this-month', channelId: null, userId: null, includeBots: true, ownerId: snowflake },
  ];
  for (const state of states) {
    for (const tag of ['first', 'prev', 'info', 'next', 'last']) {
      const id = stats.listCustomId(state, state.page, tag);
      assert.ok(id.length <= 100, id);
      assert.equal(stats.isStatsComponent(id), true);
      assert.deepEqual(stats.parseListId(id), state);
    }
  }
  assert.equal(stats.isStatsComponent('whtba:reaction-channels:add'), false);
  assert.equal(stats.parseListId('whtba:pg:x:0:0:0:0:1:next'), null);
  // Buttons on messages posted before this change keep working.
  const legacy = 'whtba:topdays:3:12345678901234567890:0:1:98765432109876543210:next';
  assert.equal(stats.isStatsComponent(legacy), true);
  assert.deepEqual(stats.parseListId(legacy), {
    kind: 'days', page: 3, range: 'all', channelId: '12345678901234567890', userId: null, includeBots: true, ownerId: '98765432109876543210',
  });
});
