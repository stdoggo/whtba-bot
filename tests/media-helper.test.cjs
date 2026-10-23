const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { findMediaLinks, mediaLinkFromUrl, proxyEmbedLine } = require('../src/media/sites');
const { mediaHelperSettings, mediaEnabledInChannel } = require('../src/media/settings');
const { handleAutomaticMedia } = require('../src/media/automatic');

test('X, Reddit, TikTok, Instagram, Bluesky, Twitch, Facebook use external embed URLs', () => {
  const examples = [
    ['https://x.com/person/status/123', 'x', 'https://fxtwitter.com/person/status/123'],
    ['https://reddit.com/r/a/comments/b', 'reddit', 'https://vxreddit.com/r/a/comments/b'],
    ['https://www.tiktok.com/@user/video/123', 'tiktok', 'https://tnktok.com/@user/video/123'],
    ['https://vm.tiktok.com/abcdef', 'tiktok', 'https://vm.tnktok.com/abcdef'],
    ['https://vt.tiktok.com/abcdef', 'tiktok', 'https://vt.tnktok.com/abcdef'],
    ['https://instagram.com/reel/ABC', 'instagram', 'https://eeinstagram.com/reel/ABC'],
    ['https://bsky.app/profile/a.bsky.social/post/abc', 'bluesky', 'https://bskye.app/profile/a.bsky.social/post/abc'],
    ['https://clips.twitch.tv/SampleClip', 'twitch', 'https://fxtwitch.seria.moe/clip/SampleClip'],
    ['https://www.facebook.com/reel/1234', 'facebook', 'https://facebed.seria.moe/reel/1234']
  ];
  for (const [url, platform, expected] of examples) {
    const result = mediaLinkFromUrl(url);
    assert.equal(result?.platform, platform);
    assert.equal(result?.fixed, expected, url);
    assert.equal(result?.original, url);
  }
});

test('YouTube Shorts uses the native YouTube player and other video sites keep native links', () => {
  assert.equal(mediaLinkFromUrl('https://youtube.com/shorts/AbCdEfGh123')?.fixed,
    'https://www.youtube.com/watch?v=AbCdEfGh123');
  for (const url of ['https://vimeo.com/1234', 'https://streamable.com/ab123', 'https://www.dailymotion.com/video/xyz']) {
    assert.equal(mediaLinkFromUrl(url)?.fixed, url);
  }
});

test('only exact domains accepted; duplicate links discarded and original link preserved', () => {
  assert.deepEqual(findMediaLinks('https://x.com.evil.net/a https://fake-tiktok.com/b'), []);
  const links = findMediaLinks('https://x.com/a, https://x.com/a https://reddit.com/r/a https://vm.tiktok.com/a https://vimeo.com/123');
  assert.equal(links.length, 3);
  assert.equal(links[0].original, 'https://x.com/a');
  assert.equal(proxyEmbedLine(links[0]), '[`twitter`](https://fxtwitter.com/a)');
});

test('media options ignore old conversion settings and are separate from reaction channels', () => {
  const a = '123456789012345678', b = '123456789012345679';
  assert.equal(mediaEnabledInChannel(mediaHelperSettings({ reactionChannelIds: [a] }), b), true);
  const configured = mediaHelperSettings({ mediaHelper: { enabled: true, allowedChannelIds: [a], autoUpload: true } });
  assert.deepEqual(configured, { enabled: true, allowedChannelIds: [a] });
  assert.equal(mediaEnabledInChannel(configured, b), false);
  assert.equal(mediaEnabledInChannel(configured, a), true);
  assert.equal(mediaEnabledInChannel(mediaHelperSettings({ mediaHelper: { enabled: false } }), a), false);
});

test('automatic links reply without ping, without file uploads/buttons, then suppress source', async () => {
  const actions = [];
  const message = {
    guildId: '123456789012345678', channelId: '123456789012345679', author: { bot: false },
    content: 'https://x.com/u/status/123',
    reply: async payload => actions.push(['reply',payload]),
    suppressEmbeds: async state => actions.push(['suppress',state])
  };
  const prisma = { serverSettings: { findFirst: async () => ({ settings: { mediaHelper: { enabled: true } } }) } };
  assert.equal(await handleAutomaticMedia(message, prisma), true);
  assert.deepEqual(actions.map(x => x[0]), ['reply','suppress']);
  assert.deepEqual(actions[0][1].allowedMentions, { parse: [], repliedUser: false });
  assert.equal(actions[0][1].files, undefined);
  assert.equal(actions[0][1].components, undefined);
  assert.ok(actions[0][1].content.includes('https://fxtwitter.com/u/status/123'));
  assert.equal(actions[1][1], true);
});

test('disabled channels, bot messages and failed replies are handled safely', async () => {
  const message = {
    guildId: '123456789012345678', channelId: '123456789012345679',
    content: 'https://x.com/u/status/1', author: { bot: false },
    reply: async () => { throw new Error('Should not send'); }
  };
  const prisma = { serverSettings: { findFirst: async () => ({
    settings: { mediaHelper: { enabled: true, allowedChannelIds: [] } }
  }) } };
  assert.equal(await handleAutomaticMedia(message, prisma), false);
  message.author.bot = true;
  assert.equal(await handleAutomaticMedia(message, prisma), false);

  message.author.bot = false;
  let suppressed = false;
  message.suppressEmbeds = async () => { suppressed = true; };
  await assert.rejects(handleAutomaticMedia(message, { serverSettings: { findFirst: async () => null } }));
  assert.equal(suppressed, false);
});

test('converted WHTBA reply receives reactions in selected channels independently of other-bot toggle', async () => {
  const ownChannel = '123456789012345678';
  const otherChannel = '123456789012345679';
  const state = { reactToBots: false, reactionChannelIds: [ownChannel], mediaHelper: { enabled: true } };
  const prisma = { serverSettings: { findFirst: async () => ({ settings: state }) } };
  const seen = [];
  const create = (channelId) => ({
    guildId: '123456789012345677', channelId, author: { bot: false },
    content: 'https://x.com/test/status/123',
    reply: async () => ({ id: '123456789012345676', channelId }),
    suppressEmbeds: async () => {}
  });
  const onFixedReply = async (reply, settings) => seen.push({ reply, settings });
  await handleAutomaticMedia(create(ownChannel), prisma, undefined, onFixedReply);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reply.id, '123456789012345676');
  assert.equal(seen[0].settings.reactToBots, false);
  state.reactToBots = true;
  await handleAutomaticMedia(create(ownChannel), prisma, undefined, onFixedReply);
  assert.equal(seen.length, 2);
  state.reactToBots = false;
  await handleAutomaticMedia(create(otherChannel), prisma, undefined, onFixedReply);
  assert.equal(seen.length, 2);
});

test('own converted links react with default emojis even without saved server settings', async () => {
  const reactions = [];
  const reply = { 
    id: '123456789012345676',
    react: async emoji => reactions.push(emoji)
  };
  const message = {
    guildId: '123456789012345677', channelId: '123456789012345678',
    author: { bot: false }, content: 'https://reddit.com/r/test/s/AbcdEf123',
    reply: async () => reply,
    suppressEmbeds: async () => {}
  };
  const prisma = { serverSettings: { findFirst: async () => null } };
  assert.equal(await handleAutomaticMedia(message, prisma, undefined,
    async (sent, settings) => {
      await sent.react(settings.likeReaction);
      await sent.react(settings.dislikeReaction);
    }), true);
  assert.deepEqual(reactions, ['👍', '👎']);
});


test('TikTok links use only clickable tiktok-<id>.mp4 labels without View original', () => {
  const long = mediaLinkFromUrl('https://www.tiktok.com/@steammhappy/video/7689983778025901343');
  assert.equal(proxyEmbedLine(long),
    '[`tiktok-7689983778025901343.mp4`](https://tnktok.com/@steammhappy/video/7689983778025901343)');
  const short = mediaLinkFromUrl('https://vt.tiktok.com/ZSbq2xBye/');
  assert.equal(proxyEmbedLine(short),
    '[`tiktok-ZSbq2xBye.mp4`](https://vt.tnktok.com/ZSbq2xBye/)');
  assert.equal(proxyEmbedLine(long).split('\n').length, 1);
});

test('all supported platforms use single-line clickable short labels', () => {
  for (const raw of [
    'https://x.com/u/status/123','https://reddit.com/r/a/comments/b',
    'https://instagram.com/reel/ABC','https://bsky.app/profile/a.bsky.social/post/abc',
    'https://youtube.com/shorts/AbCdEfGh123','https://clips.twitch.tv/SampleClip',
    'https://facebook.com/reel/1234','https://vimeo.com/1234',
    'https://streamable.com/abc','https://dailymotion.com/video/xyz',
  ]) {
    const link = mediaLinkFromUrl(raw);
    assert.ok(link);
    const text = proxyEmbedLine(link);
    assert.equal(text.split('\n').length, 1);
    assert.ok(text.startsWith('[`'));
    assert.ok(!text.includes('View original'));
    assert.ok(!text.includes(' · '));
    assert.ok(text.endsWith('`](' + link.fixed + ')'));
    assert.ok(!text.includes('View original'));
    assert.ok(!text.includes('\\n'));
  }
});

test('post IDs appear after the correct site name on every supported platform', () => {
  const cases = [
    ['https://x.com/u/status/1234567890', 'twitter-1234567890'],
    ['https://reddit.com/r/example/comments/abcd12/post', 'reddit-abcd12'],
    ['https://www.reddit.com/r/GamingLeaksAndRumours/s/JzzRODtyrd', 'reddit-JzzRODtyrd'],
    ['https://reddit.com/r/Example/s/AaBb12cdEF/', 'reddit-AaBb12cdEF'],
    ['https://reddit.com/r/Example/comments/abcd12/post?s=unrelated', 'reddit-abcd12'],
    ['https://instagram.com/reel/Cx12Ab3/', 'instagram-Cx12Ab3'],
    ['https://bsky.app/profile/person.bsky.social/post/3mka2j', 'bluesky-3mka2j'],
    ['https://youtube.com/shorts/AbCdEfGh123', 'youtube-AbCdEfGh123'],
    ['https://clips.twitch.tv/FunnyClipSlug', 'twitch-FunnyClipSlug'],
    ['https://www.twitch.tv/user/clip/FunnyClipSlug', 'twitch-FunnyClipSlug'],
    ['https://www.facebook.com/reel/987654321', 'facebook-987654321'],
    ['https://www.facebook.com/watch/?v=987654321', 'facebook-987654321'],
    ['https://vimeo.com/34567890', 'vimeo-34567890'],
    ['https://player.vimeo.com/video/34567890', 'vimeo-34567890'],
    ['https://streamable.com/abc123', 'streamable-abc123'],
    ['https://dailymotion.com/video/x9abc12', 'dailymotion-x9abc12'],
    ['https://dai.ly/x9abc12', 'dailymotion-x9abc12'],
  ];
  for (const [url, label] of cases) {
    const link = mediaLinkFromUrl(url);
    assert.ok(link, url);
    assert.equal(proxyEmbedLine(link), '[`' + label + '`](' + link.fixed + ')', url);
  }
});

test('URLs with no identifiable post number use only the platform name', () => {
  const link = mediaLinkFromUrl('https://x.com/someuser');
  assert.equal(proxyEmbedLine(link), '[`twitter`](https://fxtwitter.com/someuser)');
});

test('Reddit short share links use the share code in the clickable label', () => {
  const url = 'https://www.reddit.com/r/GamingLeaksAndRumours/s/JzzRODtyrd';
  const link = mediaLinkFromUrl(url);
  assert.ok(link);
  assert.equal(link.platform, 'reddit');
  assert.equal(link.fixed, 'https://vxreddit.com/r/GamingLeaksAndRumours/s/JzzRODtyrd');
  assert.equal(proxyEmbedLine(link),
    '[`reddit-JzzRODtyrd`](https://vxreddit.com/r/GamingLeaksAndRumours/s/JzzRODtyrd)');
});
