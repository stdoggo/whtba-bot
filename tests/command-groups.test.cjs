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
  assert.deepEqual(Commands.map(command => command.name).sort(), ['embed-settings','reaction-settings','stats']);
  assert.equal(Commands.every(command => command.options.every(option =>
    option.type === ApplicationCommandOptionType.Subcommand)), true);
});

test('reaction settings include guild, per-channel embed reactions and multi-channel picker', () => {
  assert.deepEqual(groups['reaction-settings'].options.map(option => option.name),
    ['server','channel','channels','show']);
  for (const option of ['like-reaction','dislike-reaction','react-to-bots','allow-embed-reactions']) {
    assert.ok(findSub('reaction-settings','server').options.some(o => o.name === option));
  }
  assert.ok(findSub('reaction-settings','channel').options.some(o => o.name === 'allow-embed-reactions'));
});

test('embed settings include preview filters and per-channel media moderation', () => {
  assert.deepEqual(groups['embed-settings'].options.map(option => option.name),
    ['preview','moderation','show']);
  for (const name of ['action','enabled','channel']) {
    assert.ok(findSub('embed-settings','preview').options.some(o => o.name === name));
  }
  assert.ok(findSub('embed-settings','moderation').options.some(o => o.name === 'forbid-text'));
});

test('legacy command names are not registered', () => {
  for (const retired of ['help','setupserver','setupchannel','settings','select-channels']) {
    assert.equal(Commands.some(command => command.name === retired), false);
  }
});

test('stats command is open to members, settings commands stay admin-only', () => {
  assert.deepEqual(groups.stats.options.map(option => option.name),
    ['server','user','leaderboard','channels','top-days','sync']);
  assert.equal(groups.stats.adminOnly, false);
  assert.equal(groups['embed-settings'].adminOnly, undefined);
  assert.equal(groups['reaction-settings'].adminOnly, undefined);
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
