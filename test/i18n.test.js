import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setCulture } from '../client/src/i18n.js';

test('i18n: text resolves before a culture is set (the intro screen), and culture overrides after', () => {
  setCulture(''); // locale defaults to zh-Hant (setLocale touches document, so it is not called here)
  assert.equal(t('intro.enter'), '進入山門');
  assert.equal(t('no.such.key'), 'no.such.key');
  setCulture('jp-shinto');
  assert.equal(t('intro.enter'), '進入山門'); // no @jp-shinto variant: falls back to the plain key
  setCulture('');
});
