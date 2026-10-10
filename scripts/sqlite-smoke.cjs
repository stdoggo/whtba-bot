const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

// CI-only integration smoke test. Must always use the disposable ci-whtba.db,
// NEVER run this script against a user's normal whtba.db database.
if (!process.env.DATABASE_URL?.endsWith('/ci-whtba.db')) {
  throw new Error('Refusing SQLite smoke test outside the disposable ci-whtba.db file.');
}
const prisma = new PrismaClient();
(async () => {
  const guildId = BigInt('123456789012345678');
  const channelId = BigInt('123456789012345679');
  const world = await prisma.world.create({ data: { id: 1n } });
  await prisma.server.create({ data: { id: guildId, worldId: world.id } });
  const settings = { likeReaction: '👍', dislikeReaction: '👎', reactToBots: true,
    reactionChannelIds: [guildId.toString()], mediaHelper: { enabled: true } };
  await prisma.serverSettings.create({ data: { id: guildId, settings } });
  await prisma.channelSettings.create({ data: { id: channelId, serverId: guildId, settings: { isTextForbidden: false } } });
  await prisma.message.create({ data: { id: BigInt('123456789012345680'), worldUserId: guildId, serverId: guildId,
    channelId, content: { platform: 'tiktok', source: 'https://example.org' } } });
  const saved = await prisma.serverSettings.findUniqueOrThrow({ where: { id: guildId } });
  assert.deepEqual(saved.settings, settings);
  const msg = await prisma.message.findFirstOrThrow({ where: { serverId: guildId } });
  assert.equal(msg.channelId, channelId);
  assert.deepEqual(msg.content, { platform: 'tiktok', source: 'https://example.org' });
  const channel = await prisma.channelSettings.findUniqueOrThrow({ where: { id: channelId } });
  assert.equal(channel.settings.isTextForbidden, false);
  console.log('SQLite smoke test OK: bigint IDs, settings JSON, channel JSON, message JSON.');
})().catch(err => { console.error(err); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
