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
  assert.equal(proxyEmbedLine(links[0]), '-# [View original](<https://x.com/a>)\n-# https://fxtwitter.com/a');
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
