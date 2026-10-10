const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { toDatabaseId, databaseValue } = require('../src/queries/id-values');
const { generalizedFindAndCreate } = require('../src/queries/generalized-find-and-create');
const { generalizedUpsert, generalizedUpsertSpecial } = require('../src/queries/generalized-upsert');
const { generalizedUpdate } = require('../src/queries/generalized-update');
const { generalizedFindById } = require('../src/queries/generalized-find-by-id');
const ids = ['123456789012345678', '123456789012345679'];

test('adjacent snowflakes above the safe integer limit remain distinct', () => {
  assert.equal(Number(ids[0]), Number(ids[1]));
  assert.notEqual(toDatabaseId(ids[0]), toDatabaseId(ids[1]));
  assert.equal(toDatabaseId(ids[0]).toString(), ids[0]);
  assert.throws(() => toDatabaseId(Number(ids[0])), RangeError);
});

test('SQL relations convert IDs but preserve counters and JSON columns', () => {
  assert.deepEqual(databaseValue('server', { connect: { id: ids[0] } }), { connect: { id: BigInt(ids[0]) } });
  assert.equal(databaseValue('likeCount', 3), 3);
  for (const field of ['settings', 'content']) {
    const json = { id: ids[0], nested: { userId: ids[1] } };
    assert.equal(databaseValue(field, json), json);
    assert.doesNotThrow(() => JSON.stringify(databaseValue(field, json)));
  }
});

test('every query helper preserves exact IDs in lookups, writes and relations', async () => {
  const calls = [];
  const prisma = { message: {
    upsert: async args => { calls.push(args); return args; },
    update: async args => { calls.push(args); return args; },
    findFirst: async args => { calls.push(args); return args; },
  } };
  const values = [{ k: 'userId', v: ids[1] }, { k: 'server', v: { connect: { id: ids[0] } } }];
  const params = { modelName: 'message', uniqueId: ids[0], kvpArray: values, prisma };
  await generalizedFindAndCreate(params);
  await generalizedUpsert(params);
  await generalizedUpsertSpecial({ ...params, kvpArrayCreate: values, kvpArrayUpdate: values });
  await generalizedUpdate(params);
  await generalizedFindById({ ...params, kvpArray: [{ k: 'id', v: ids[0] }] });
  for (const args of calls) {
    assert.equal(args.where.id, BigInt(ids[0]));
    for (const data of [args.create, args.update, args.data].filter(Boolean)) {
      if ('userId' in data) assert.equal(data.userId, BigInt(ids[1]));
      if ('server' in data) assert.equal(data.server.connect.id, BigInt(ids[0]));
    }
  }
});

test('removed refresh reaction does not add or remove Discord reactions', async () => {
  // Isolate the event handler from startup: never log into Discord during tests.
  const utilsPath = require.resolve('../src/utils');
  require.cache[utilsPath] = { id: utilsPath, filename: utilsPath, loaded: true, exports: { numberExtractRegex: /(\d+)(?!.*\d)/g } };
  const messagePath = require.resolve('../src/handlers/message');
  require.cache[messagePath] = { id: messagePath, filename: messagePath, loaded: true, exports: {
    getMessageParams: (channelId, serverId, userId, message) => ({ channelId, serverId, userId, messageId: message.id, content: {} })
  } };
  const { processReaction } = require('../src/handlers/reactions');
  const { Collection } = require('discord.js');
  let mutations = 0;
  const cache = new Collection([['👍', { count: 2 }], ['👎', { count: 1 }]]);
  const message = { id: ids[0], author: { id: ids[1] }, guild: { id: ids[0] }, channel: { id: ids[1] }, reactions: { cache }, react: () => { mutations++; } };
  const prisma = {
    serverSettings: { findFirst: async () => ({ settings: { likeReaction: '👍', dislikeReaction: '👎' } }) },
    message: { upsert: async () => ({}) }
  };
  for (const added of [true, false]) {
    await processReaction({}, { message, emoji: { name: '\u267b\ufe0f' }, users: { remove: () => { mutations++; } } }, added, { id: ids[1] }, prisma);
  }
  assert.equal(mutations, 0);
});
