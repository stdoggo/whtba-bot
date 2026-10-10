const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { findMediaLinks, mediaLinkFromUrl, proxyEmbedLine } = require('../src/media/sites');
const { mediaHelperSettings, mediaEnabledInChannel } = require('../src/media/settings');
const { normalizeOptions } = require('../src/media/engine');

test('X, Reddit, TikTok, Instagram, Bluesky, Shorts, Twitch, Facebook and extras are recognized', () => {
  const samples = [
    ['https://x.com/person/status/123', 'x', 'fxtwitter.com'],
    ['https://reddit.com/r/a/comments/b', 'reddit', 'vxreddit.com'],
    ['https://vm.tiktok.com/code', 'tiktok', 'd.tnktok.com'],
    ['https://instagram.com/reel/ABC', 'instagram', 'deinstagram.com'],
    ['https://bsky.app/profile/a.bsky.social/post/abc', 'bluesky', 'bskye.app'],
    ['https://youtube.com/shorts/AbCdEfGh123', 'youtube', 'youtube.com/watch?v=AbCdEfGh123'],
    ['https://clips.twitch.tv/SampleClip', 'twitch', 'clips.twitch.tv'],
    ['https://www.facebook.com/reel/1234', 'facebook', 'facebook.com'],
    ['https://vimeo.com/1234', 'vimeo', 'vimeo.com'],
    ['https://streamable.com/ab123', 'streamable', 'streamable.com'],
    ['https://www.dailymotion.com/video/xyz', 'dailymotion', 'dailymotion.com']
  ];
  for (const [url, platform, expected] of samples) {
    const result = mediaLinkFromUrl(url);
    assert.equal(result.platform, platform, url);
    assert.ok(result.fixed.includes(expected), url);
    assert.equal(result.original, url);
  }
});

test('only allowlisted exact domains are recognized; deduplicate and truncate', () => {
  assert.deepEqual(findMediaLinks('https://x.com.evil.net/post https://evil-twitter.com/post'), []);
  const links = findMediaLinks('https://x.com/a, https://x.com/a https://reddit.com/r/a https://vm.tiktok.com/a https://vimeo.com/123');
  assert.equal(links.length, 3);
  assert.equal(links[0].original, 'https://x.com/a');
  assert.equal(proxyEmbedLine(links[0]).startsWith('-# [View original](<https://x.com/a>)'), true);
});

test('media preferences are independent of the emoji reaction channels', () => {
  const a = '123456789012345678';
  const b = '123456789012345679';
  const initial = mediaHelperSettings({ reactionChannelIds: [a] });
  assert.equal(mediaEnabledInChannel(initial, b), true);
  const custom = mediaHelperSettings({ mediaHelper: { enabled: true, allowedChannelIds: [a] } });
  assert.equal(mediaEnabledInChannel(custom, b), false);
  assert.equal(mediaEnabledInChannel(custom, a), true);
  assert.equal(mediaEnabledInChannel(mediaHelperSettings({ mediaHelper: { enabled: false } }), a), false);
});

test('validate limits and options for conversions', () => {
  assert.equal(normalizeOptions('mp3').format, 'mp3');
  assert.equal(normalizeOptions('speed','','','1.5').speed, 1.5);
  assert.equal(normalizeOptions('gif').format, 'gif');
  assert.equal(normalizeOptions('reverse').format, 'reverse');
  assert.equal(normalizeOptions('soundboard').duration, 5);
  assert.throws(() => normalizeOptions('unknown'));
  assert.throws(() => normalizeOptions('trim'));
  assert.throws(() => normalizeOptions('speed','','','10'));
  assert.throws(() => normalizeOptions('caption'));
});
