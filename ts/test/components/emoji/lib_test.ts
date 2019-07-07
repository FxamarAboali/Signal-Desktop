import { assert } from 'chai';

import { replaceColons } from '../../../components/emoji/lib';

describe('replaceColons', () => {
  it('replaces known emoji short names between colons', () => {
    const anEmoji = replaceColons('hello :grinning:');
    assert.equal(anEmoji, 'hello 😀');
  });

  it('understands skin tone modifiers', () => {
    const skinToneModifierEmoji = replaceColons('hello :wave::skin-tone-5:!');
    assert.equal(skinToneModifierEmoji, 'hello 👋🏿!');
  });

  it('passes through strings with no colons', () => {
    const noEmoji = replaceColons('hello');
    assert.equal(noEmoji, 'hello');
  });

  it('ignores unknown emoji', () => {
    const unknownEmoji = replaceColons(':Unknown: :unknown:');
    assert.equal(unknownEmoji, ':Unknown: :unknown:');
  });
});
