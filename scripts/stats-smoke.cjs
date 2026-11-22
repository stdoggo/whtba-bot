const assert = require('node:assert/strict');
require('ts-node/register/transpile-only');
const { PrismaClient } = require('@prisma/client');
const { Collection, ChannelType, DiscordAPIError } = require('discord.js');

// CI-only integration test for message statistics against the disposable
// ci-whtba.db. It simulates Discord channels; it never connects to Discord.
if (!process.env.DATABASE_URL?.endsWith('/ci-whtba.db')) {
  throw new Error('Refusing stats smoke test outside the disposable ci-whtba.db file.');
}
const { MessageStatsService } = require('../src/stats/service');
const store = require('../src/stats/store');
const time = require('../src/stats/time');

const prisma = new PrismaClient();
const zone = 'Europe/Istanbul';
const sf = iso => time.msToSnowflake(Date.parse(iso));
let sequence = 0n;
const makeMessage = (channel, iso, authorId, extra = {}) => {
  const id = (sf(iso) + (sequence++ % 4000n)).toString();
  return { id, guildId: '1', channelId: channel.id, channel, system: false, webhookId: null,
    author: { id: authorId, bot: authorId === '900', username: 'user' + authorId, globalName: null }, member: null, ...extra };
};

// A fake channel that serves its messages like the Discord REST API.
const fakeChannel = (id, type, extra = {}) => {
  const channel = { id, type, name: 'kanal-' + id, parentId: null, lastMessageId: null, history: [], fetches: 0,
    permissionsFor: () => ({ has: () => true }),
    threads: { fetchArchived: async () => ({ threads: new Collection(), hasMore: false }) },
    ...extra };
  channel.messages = { fetch: async ({ limit, before, after }) => {
    channel.fetches++;
    let list = [...channel.history].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1)); // newest first
    if (before) list = list.filter(m => BigInt(m.id) < BigInt(before));
    if (after) list = list.filter(m => BigInt(m.id) > BigInt(after)).reverse().slice(0, limit).reverse();
    return new Collection(list.slice(0, limit).map(m => [m.id, m]));
  } };
  return channel;
};
const add = (channel, message) => {
  channel.history.push(message);
  channel.lastMessageId = message.id;
  return message;
};

(async () => {
  await prisma.messageLog.deleteMany();
  await prisma.messageAuthor.deleteMany();
  await prisma.messageSyncChannel.deleteMany();
  await prisma.messageStatsState.deleteMany();

  const general = fakeChannel('100', ChannelType.GuildText);
  const forum = fakeChannel('200', ChannelType.GuildForum);
  const thread = fakeChannel('300', ChannelType.PublicThread, { parentId: '200' });
  const archived = fakeChannel('400', ChannelType.PublicThread, { parentId: '200', archiveTimestamp: Date.parse('2022-01-01') });
  forum.threads.fetchArchived = async () => ({ threads: new Collection([[archived.id, archived]]), hasMore: false });

  // 250 history messages over two days in #general, plus thread messages and noise.
  for (let i = 0; i < 250; i++) add(general, makeMessage(general, i < 150 ? '2022-03-10T09:00:00Z' : '2022-03-11T09:00:00Z', String(1 + (i % 3))));
  add(general, makeMessage(general, '2022-03-11T10:00:00Z', '900')); // bot
  add(general, makeMessage(general, '2022-03-11T10:00:00Z', '1', { system: true })); // join message
  for (let i = 0; i < 30; i++) add(thread, makeMessage(thread, '2023-06-01T12:00:00Z', '2'));
  for (let i = 0; i < 5; i++) add(archived, makeMessage(archived, '2021-12-31T22:30:00Z', '3')); // 1 Jan 2022 in Istanbul

  // Empty during the scan; receives messages later while the bot is offline.
  const empty = fakeChannel('500', ChannelType.GuildText);
  // The bot has no access during the first scan; access is granted later.
  const locked = fakeChannel('600', ChannelType.GuildText);
  for (let i = 0; i < 4; i++) add(locked, makeMessage(locked, '2022-05-05T12:00:00Z', '5'));
  let lockedDenied = true;
  const lockedFetch = locked.messages.fetch;
  locked.messages.fetch = async options => {
    if (lockedDenied) throw new DiscordAPIError({ code: 50001, message: 'Missing Access' }, 50001, 403, 'GET', '/channels/600/messages', {});
    return lockedFetch(options);
  };

  const guildChannels = new Collection([[general.id, general], [forum.id, forum], [empty.id, empty], [locked.id, locked]]);
  const guild = {
    members: { me: {}, cache: new Collection() },
    channels: {
      cache: new Collection([[general.id, general], [forum.id, forum], [thread.id, thread], [empty.id, empty], [locked.id, locked]]),
      fetch: async () => guildChannels,
      fetchActiveThreads: async () => ({ threads: new Collection([[thread.id, thread]]) }),
    },
  };

  const service = new MessageStatsService(prisma);
  await service.onSessionReady(guild);

  // A live message arriving before the history scan is counted once.
  const live = add(general, makeMessage(general, '2024-01-01T12:00:00Z', '1'));
  service.record(live);
  await service.flush();

  assert.equal(await service.startBackfill(guild), 'started');
  for (let i = 0; i < 200 && (await service.getProgress()).running; i++) await new Promise(r => setTimeout(r, 25));
  const progress = await service.getProgress();
  assert.equal(progress.status, 'done');
  assert.equal(progress.totalChannels, 5);
  assert.equal(progress.doneChannels, 4, 'the inaccessible channel is not counted as done');
  assert.equal(progress.skippedChannels, 1);
  assert.equal(await service.isHistoryComplete(), true);

  const everything = { startId: 0n, endId: 1n << 62n };
  assert.equal(await store.countMessages(prisma, everything), 250 + 30 + 5 + 1, 'humans only, no system messages');
  assert.equal(await store.countMessages(prisma, { ...everything, includeBots: true }), 250 + 30 + 5 + 1 + 1);
  assert.equal(await store.countMessages(prisma, { ...everything, channelId: '200' }), 35, 'threads count for their parent');

  // Top days, in local time.
  const days = time.hoursToDays(await store.countByHour(prisma, everything), zone);
  const top = time.rankDays(days, 20);
  assert.deepEqual(top.map(([d, c]) => [time.formatDay(d), c]),
    [['10 Mart 2022', 150], ['11 Mart 2022', 100], ['1 Haziran 2023', 30], ['1 Ocak 2022', 5], ['1 Ocak 2024', 1]]);

  // Leaderboard and rank.
  const leaders = await store.topAuthors(prisma, everything, 3);
  assert.deepEqual(leaders.map(l => [l.id, l.count]), [['2', 113], ['3', 88], ['1', 85]]);
  assert.deepEqual(await store.authorRank(prisma, everything, '1'), { rank: 3, count: 85 });
  const channels = await store.topChannels(prisma, everything, 5);
  assert.deepEqual(channels.map(c => [c.id, c.count]), [['100', 251], ['200', 35]]);

  // Range filter: March 2022 only.
  const range = time.resolveRange({ from: '2022-03', to: '2022-03', nowMs: Date.now(), earliestMs: 0, zone });
  const march = { startId: time.msToSnowflake(range.startMs), endId: time.msToSnowflake(range.endMs) };
  assert.equal(await store.countMessages(prisma, march), 250);

  // Deleting a message removes it from the statistics.
  await service.forget([live.id]);
  assert.equal(await store.countMessages(prisma, everything), 285);

  // Messages sent while the bot was offline are caught up on the next session.
  const fetchesBefore = general.fetches;
  for (let i = 0; i < 120; i++) add(general, makeMessage(general, '2024-02-02T12:00:00Z', '4'));
  // Sent after the scan (i.e. now), while the bot was offline.
  for (let i = 0; i < 7; i++) add(empty, makeMessage(empty, new Date(Date.now() + 1000).toISOString(), '6'));
  await store.saveAuthorNames(prisma, [{ id: '4', name: 'Takma Ad' }]);
  await service.onSessionReady(guild);
  for (let i = 0; i < 200 && (await service.getProgress()).catchUpRunning; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(await store.countMessages(prisma, { ...everything, authorId: '4' }), 120);
  assert.equal(general.fetches - fetchesBefore, 2, 'catch-up pages forward from the watermark');
  assert.equal(thread.fetches, 1, 'channels without new messages are not fetched again');
  assert.equal(await store.countMessages(prisma, { ...everything, channelId: '500' }), 7, 'channel that was empty during the scan');
  assert.equal((await store.getAuthorNames(prisma, ['4'])).get('4'), 'Takma Ad', 'catch-up keeps the saved display name');

  // Access granted later: running the scan again picks up the previously denied channel.
  lockedDenied = false;
  assert.equal(await service.startBackfill(guild), 'started');
  for (let i = 0; i < 200 && (await service.getProgress()).running; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(await store.countMessages(prisma, { ...everything, channelId: '600' }), 4, 'previously inaccessible channel');
  assert.equal((await service.getProgress()).skippedChannels, 0);

  // Author names: history never overwrites a newer live name.
  await store.saveAuthorNames(prisma, [{ id: '1', name: 'Yeni Ad' }]);
  await store.saveAuthorNames(prisma, [{ id: '1', name: 'Eski Ad' }], false);
  assert.equal((await store.getAuthorNames(prisma, ['1'])).get('1'), 'Yeni Ad');

  await service.shutdown();
  console.log('Stats smoke test OK: history scan, threads, live, delete, catch-up, rankings, top days.');
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
