const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { findSocialLinks, fixedLinkText, handleSocialLinks } = require('../src/handlers/social-links');

test('X, Reddit and TikTok links are converted without modifying the source', () => {
  assert.deepEqual(findSocialLinks('https://x.com/abc/status/123?x=1'), [{
    platform: 'x', original: 'https://x.com/abc/status/123?x=1',
    fixed: 'https://fxtwitter.com/abc/status/123?x=1',
  }]);
  assert.equal(findSocialLinks('https://old.reddit.com/r/test/comments/abc/')[0].fixed,
    'https://vxreddit.com/r/test/comments/abc/');
  assert.equal(findSocialLinks('https://vt.tiktok.com/ZSbo2xBye/')[0].fixed,
    'https://d.tnktok.com/ZSbo2xBye/');
});

test('unrelated, already-converted and lookalike domains are ignored', () => {
  assert.deepEqual(findSocialLinks('https://evil-x.com/ https://fxtwitter.com/a/ https://x.com.evil.test/'), []);
});

test('duplicate links are ignored, trailing punctuation is stripped and 3 links max are processed', () => {
  const links = findSocialLinks('https://x.com/a/status/1, https://x.com/a/status/1 https://reddit.com/r/a/ https://vt.tiktok.com/abc/ https://x.com/extra/');
  assert.equal(links.length, 3);
  assert.equal(links[0].original, 'https://x.com/a/status/1');
});

test('fixed links retain embed-able URL and use Discord small subtext for original', () => {
  const text = fixedLinkText(findSocialLinks('https://x.com/a/status/123')[0]);
  assert.equal(text, '-# [View original](<https://x.com/a/status/123>)\n-# https://fxtwitter.com/a/status/123');
});

test('replies are linked to the original with no ping and the original embed is suppressed', async () => {
  const replies = [];
  const suppressed = [];
  const message = {
    guildId: '123456789012345678', author: { bot: false },
    content: 'https://x.com/test/status/123',
    reply: async options => { replies.push(options); },
    suppressEmbeds: async value => { suppressed.push(value); },
  };
  await handleSocialLinks(message);
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: false });
  assert.deepEqual(suppressed, [true]);
});

test('bot and non-server messages are never processed', async () => {
  let replies = 0;
  const message = { guildId: null, author: { bot: false }, content: 'https://x.com/a/status/1',
    reply: () => { replies++; } };
  await handleSocialLinks(message);
  message.guildId = '123456789012345678';
  message.author.bot = true;
  await handleSocialLinks(message);
  assert.equal(replies, 0);
});
