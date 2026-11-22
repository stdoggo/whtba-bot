const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { Collection, ChannelType, PermissionFlagsBits } = require('discord.js');
const { findMessageLinks, buildMessagePreview, canPreview, resolveMessagePreviews } = require('../src/media/message-links');
const { handleAutomaticMedia } = require('../src/media/automatic');
const { mediaHelperSettings, messageLinksEnabled } = require('../src/media/settings');

const guild = '123456789012345678';
const link = (channel, message, host = 'discord.com') => 'https://' + host + '/channels/' + guild + '/' + channel + '/' + message;
const C1 = '223456789012345678', C2 = '323456789012345678';
const M1 = '423456789012345678', M2 = '523456789012345678';

test('message links: only this server, all Discord hosts, no duplicates, <link> suppressed', () => {
  const content = [
    'bak ' + link(C1, M1), link(C1, M1) + '.', // duplicate with punctuation
    link(C2, M2, 'ptb.discord.com'),
    '<' + link(C1, '623456789012345678') + '>', // suppressed like Discord does
    'https://discord.com/channels/999999999999999999/' + C1 + '/' + M1, // other server
    'https://discord.com.evil.net/channels/' + guild + '/' + C1 + '/' + M1,
  ].join(' ');
  const found = findMessageLinks(content, guild);
  assert.deepEqual(found.map(item => [item.channelId, item.messageId]), [[C1, M1], [C2, M2]]);
  assert.equal(found[1].url, link(C2, M2), 'links are normalised to discord.com');
  assert.equal(findMessageLinks(link(C1, M1, 'canary.discordapp.com'), guild).length, 1);
  const many = [1, 2, 3, 4].map(i => link(C1, '72345678901234567' + i)).join(' ');
  assert.equal(findMessageLinks(many, guild).length, 3);
});

const fakeMessage = (overrides = {}) => ({
  content: 'doggoyu larpla',
  author: { username: 'sparkley', globalName: null, displayAvatarURL: () => 'https://cdn/avatar.png' },
  member: { displayName: 'Sparkley', displayColor: 0xffcc00, displayAvatarURL: () => 'https://cdn/member.png' },
  createdAt: new Date('2026-11-20T20:23:00Z'),
  attachments: new Collection(),
  embeds: [],
  stickers: new Collection(),
  ...overrides,
});
const target = { url: link(C1, M1), guildId: guild, channelId: C1, messageId: M1 };

test('preview shows author, text, first image, other files and time', () => {
  const attachments = new Collection([
    ['1', { name: 'wordle.png', contentType: 'image/png', url: 'https://cdn/wordle.png' }],
    ['2', { name: 'notlar.pdf', contentType: 'application/pdf', url: 'https://cdn/notlar.pdf' }],
  ]);
  const embed = buildMessagePreview(fakeMessage({ attachments }), target).toJSON();
  assert.equal(embed.author.name, 'Sparkley');
  assert.equal(embed.author.icon_url, 'https://cdn/member.png');
  assert.equal(embed.author.url, target.url);
  assert.equal(embed.color, 0xffcc00);
  assert.match(embed.description, /^doggoyu larpla/);
  assert.match(embed.description, /📎 \[notlar\.pdf\]\(https:\/\/cdn\/notlar\.pdf\)/);
  assert.equal(embed.image.url, 'https://cdn/wordle.png');
  assert.equal(embed.timestamp, '2026-11-20T20:23:00.000Z');
});

test('preview falls back to embed text and image, and never sends an empty embed', () => {
  const fromEmbed = buildMessagePreview(fakeMessage({ content: '', member: null,
    embeds: [{ description: 'Wordle No. 1981', image: { url: 'https://cdn/board.png' } }] }), target).toJSON();
  assert.equal(fromEmbed.description, 'Wordle No. 1981');
  assert.equal(fromEmbed.image.url, 'https://cdn/board.png');
  assert.equal(fromEmbed.author.name, 'sparkley');
  const empty = buildMessagePreview(fakeMessage({ content: '' }), target).toJSON();
  assert.ok(empty.description);
  const long = buildMessagePreview(fakeMessage({ content: 'x'.repeat(5000) }), target).toJSON();
  assert.ok(long.description.length <= 1800);
});

const permissions = (allowed = true, extra = []) => ({ has: wanted => {
  const list = Array.isArray(wanted) ? wanted : [wanted];
  return list.every(flag => (allowed && [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory].includes(flag)) || extra.includes(flag));
} });
const textChannel = (extra = {}) => ({
  guildId: guild, type: ChannelType.GuildText, nsfw: false, isTextBased: () => true,
  permissionsFor: () => permissions(true), messages: { fetch: async () => fakeMessage() }, ...extra,
});

test('the poster must be able to read the linked channel; NSFW stays in NSFW channels', () => {
  const member = { id: '1' };
  const source = { nsfw: false };
  assert.equal(canPreview(textChannel(), source, member), true);
  assert.equal(canPreview(textChannel({ permissionsFor: () => permissions(false) }), source, member), false);
  assert.equal(canPreview(textChannel({ nsfw: true }), source, member), false);
  assert.equal(canPreview(textChannel({ nsfw: true }), { nsfw: true }, member), true);
  assert.equal(canPreview(textChannel({ parent: { nsfw: true } }), source, member), false, 'threads inherit NSFW');
  assert.equal(canPreview(textChannel(), source, null), false);
});

test('resolving skips other servers, private threads the poster is not in, and missing messages', async () => {
  const channels = {
    [C1]: textChannel(),
    [C2]: textChannel({ type: ChannelType.PrivateThread, members: { fetch: async () => { throw new Error('Unknown Member'); } } }),
    '623456789012345678': textChannel({ guildId: '999999999999999999' }),
    '723456789012345678': textChannel({ messages: { fetch: async () => { throw new Error('Unknown Message'); } } }),
  };
  const message = {
    guildId: guild, channel: { nsfw: false }, member: { id: '1' },
    client: { channels: { fetch: async id => channels[id] ?? null } },
  };
  const links = Object.keys(channels).map(id => ({ url: link(id, M1), guildId: guild, channelId: id, messageId: M1 }));
  const previews = await resolveMessagePreviews(message, links);
  assert.deepEqual(previews.map(preview => preview.link.channelId), [C1]);

  channels[C2].members.fetch = async () => ({ id: '1' }); // now a thread member
  assert.equal((await resolveMessagePreviews(message, links)).length, 2);
});

const settingsPrisma = mediaHelper => ({ serverSettings: { findFirst: async () => ({ settings: { mediaHelper } }) } });
const sourceMessage = (content, actions) => ({
  guildId: guild, channelId: C1, author: { bot: false }, content,
  reply: async payload => { actions.push(['reply', payload]); return payload; },
  suppressEmbeds: async state => actions.push(['suppress', state]),
});
const fakePreviews = async (_message, links) => links.map(item => ({ link: item, embed: { preview: item.messageId }, videos: [] }));

test('a message link replies with the link and its preview, without ping, suppress or votes', async () => {
  const actions = [];
  const messageLinks = findMessageLinks(link(C1, M1), guild);
  let voted = false;
  const handled = await handleAutomaticMedia(sourceMessage(link(C1, M1), actions), settingsPrisma({ enabled: true }), [],
    async () => { voted = true; }, { messageLinks, resolvePreviews: fakePreviews });
  assert.equal(handled, true);
  assert.deepEqual(actions.map(action => action[0]), ['reply']);
  assert.equal(actions[0][1].content, link(C1, M1));
  assert.deepEqual(actions[0][1].embeds, [{ preview: M1 }]);
  assert.deepEqual(actions[0][1].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(voted, false);
});

test('media links and message links share one reply; media lines come first', async () => {
  const actions = [];
  const content = 'https://x.com/u/status/123 ' + link(C1, M1);
  const handled = await handleAutomaticMedia(sourceMessage(content, actions), settingsPrisma({ enabled: true }), undefined,
    undefined, { messageLinks: findMessageLinks(content, guild), resolvePreviews: fakePreviews });
  assert.equal(handled, true);
  assert.deepEqual(actions.map(action => action[0]), ['reply', 'suppress']);
  assert.equal(actions[0][1].content, '[`twitter-123`](https://fxtwitter.com/u/status/123)\n\n' + link(C1, M1));
});

test('message link previews follow the /embed preview switches and channel list', async () => {
  const messageLinks = findMessageLinks(link(C1, M1), guild);
  const run = async mediaHelper => {
    const actions = [];
    const handled = await handleAutomaticMedia(sourceMessage(link(C1, M1), actions), settingsPrisma(mediaHelper), [],
      undefined, { messageLinks, resolvePreviews: fakePreviews });
    return { handled, replies: actions.length };
  };
  assert.deepEqual(await run({ enabled: false }), { handled: false, replies: 0 });
  assert.deepEqual(await run({ enabled: true, messageLinks: false }), { handled: false, replies: 0 });
  assert.deepEqual(await run({ enabled: true, allowedChannelIds: [C2] }), { handled: false, replies: 0 });
  assert.deepEqual(await run({ enabled: true, allowedChannelIds: [C1] }), { handled: true, replies: 1 });
  // Nothing previewable (e.g. private channel) means no reply at all.
  const actions = [];
  assert.equal(await handleAutomaticMedia(sourceMessage(link(C1, M1), actions), settingsPrisma({ enabled: true }), [],
    undefined, { messageLinks, resolvePreviews: async () => [] }), false);
  assert.equal(actions.length, 0);
});

test('message link setting is on by default and stored only when changed', () => {
  assert.equal(messageLinksEnabled(mediaHelperSettings({})), true);
  assert.deepEqual(mediaHelperSettings({ mediaHelper: { enabled: true } }), { enabled: true });
  const off = mediaHelperSettings({ mediaHelper: { enabled: true, messageLinks: false } });
  assert.equal(messageLinksEnabled(off), false);
  assert.equal(off.messageLinks, false);
});

test('videos are not shown as files in the preview but returned for the reply text', () => {
  const { previewVideos } = require('../src/media/message-links');
  const attachments = new Collection([
    ['1', { name: 'Niche_or_larp_meme.webm', contentType: 'video/webm', url: 'https://cdn/meme.webm' }],
    ['2', { name: 'clip.MP4', contentType: null, url: 'https://cdn/clip.MP4' }],
    ['3', { name: 'notlar.pdf', contentType: 'application/pdf', url: 'https://cdn/notlar.pdf' }],
  ]);
  const embeds = [{ url: 'https://www.youtube.com/watch?v=abc', video: { url: 'https://www.youtube.com/embed/abc' } }, { url: 'https://example.org' }];
  const message = fakeMessage({ content: '', attachments, embeds });
  assert.deepEqual(previewVideos(message), ['https://cdn/meme.webm', 'https://cdn/clip.MP4', 'https://www.youtube.com/watch?v=abc']);
  const embed = buildMessagePreview(message, target).toJSON();
  assert.ok(!embed.description.includes('meme.webm'));
  assert.match(embed.description, /notlar\.pdf/);
  const onlyVideo = buildMessagePreview(fakeMessage({ content: '', attachments: new Collection([attachments.first()].map(a => ['1', a])) }), target).toJSON();
  assert.equal(onlyVideo.description, '🎞️ Video aşağıda.');
});

test('reply text: link, then its videos; stays within 2000 characters', () => {
  const { replyContent } = require('../src/media/automatic');
  const preview = (id, videos) => ({ link: { url: link(C1, id) }, embed: {}, videos });
  assert.equal(replyContent([], [preview(M1, ['https://cdn/a.webm', 'https://cdn/b.mp4'])]),
    link(C1, M1) + '\nhttps://cdn/a.webm\nhttps://cdn/b.mp4');
  const long = 'https://cdn.discordapp.com/attachments/' + 'x'.repeat(300) + '.mp4';
  const content = replyContent([], [1, 2, 3].map(i => preview('42345678901234567' + i, [long, long + '1', long + '2', long + '3'])));
  assert.ok(content.length <= 2000, String(content.length));
  for (const i of [1, 2, 3]) assert.ok(content.includes(link(C1, '42345678901234567' + i)), 'every message link is kept');
});
