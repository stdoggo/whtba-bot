const assert = require('node:assert/strict');
const { test } = require('node:test');
require('ts-node/register/transpile-only');
const { getReactionChannelIds, isReactionChannelAllowed, changeReactionChannels } =
  require('../src/settings/reaction-channels');

const a = '123456789012345678';
const b = '123456789012345679';
const c = '123456789012345680';

test('legacy servers default to all channels', () => {
  assert.equal(getReactionChannelIds({ likeReaction: '👍' }), undefined);
  assert.equal(isReactionChannelAllowed({}, a), true);
});
test('selected channels are allowed and an empty selection blocks all', () => {
  assert.equal(isReactionChannelAllowed({ reactionChannelIds: [a, c] }, a), true);
  assert.equal(isReactionChannelAllowed({ reactionChannelIds: [a, c] }, b), false);
  assert.equal(isReactionChannelAllowed({ reactionChannelIds: [] }, a), false);
});
test('repeated additions preserve and deduplicate channels', () => {
  assert.deepEqual(changeReactionChannels(undefined, [a, b], 'add'), [a, b]);
  assert.deepEqual(changeReactionChannels([a, b], [b, c], 'add'), [a, b, c]);
});
test('remove preserves other channels and clear disables all', () => {
  assert.deepEqual(changeReactionChannels([a, b, c], [b], 'remove'), [a, c]);
  assert.deepEqual(changeReactionChannels([a, c], [], 'clear'), []);
});
test('invalid saved IDs cannot expand the selection', () => {
  assert.deepEqual(getReactionChannelIds({ reactionChannelIds: ['invalid', a] }), [a]);
  assert.equal(isReactionChannelAllowed({ reactionChannelIds: ['invalid'] }, a), false);
});
