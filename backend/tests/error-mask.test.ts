import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { safeErrorMessage } from '../src/utils/error-mask.js';

test('safeErrorMessage masks api key', () => {
  const raw = 'Request failed api_key=sk_test_1234567890abcdef';
  const masked = safeErrorMessage(new Error(raw));
  assert.ok(!masked.includes('sk_test_1234567890abcdef'));
  assert.ok(masked.includes('api_key=***'));
});

test('safeErrorMessage masks Bearer token', () => {
  const raw = 'Unauthorized Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTYifQ';
  const masked = safeErrorMessage(new Error(raw));
  assert.ok(masked.includes('Bearer ***'));
  assert.ok(!masked.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
});

test('safeErrorMessage shortens long strings', () => {
  const long = 'a'.repeat(40);
  const masked = safeErrorMessage(new Error(long));
  assert.ok(masked.includes('aaaaaaaa***'));
});

test('safeErrorMessage masks OpenAI "API key provided: sk-xxx" format (space-separated, short sk- value)', () => {
  // 回归：R3-2 盲区——"provided:" 空格分隔 + sk- 短值（<32 字符）原先漏掩码
  const raw = 'Incorrect API key provided: sk-test1234567890abcdefgh. You can find';
  const masked = safeErrorMessage(raw);
  assert.ok(!masked.includes('sk-test1234567890abcdefgh'), `sk- value masked, got: ${masked}`);
  assert.ok(masked.includes('sk-***'), `masked form present, got: ${masked}`);
});

test('safeErrorMessage masks short sk- value in api_key= too (8~40 chars, not just 32+)', () => {
  const raw = 'Invalid api_key=sk-abcdef1234567890abcdef supplied';
  const masked = safeErrorMessage(new Error(raw));
  assert.ok(!masked.includes('sk-abcdef1234567890abcdef'), `short sk- value masked, got: ${masked}`);
});

test('safeErrorMessage does not mask ordinary text with sk- prefix shorter than 8 chars', () => {
  // 白名单原则：仅 sk- + 8~40 字符触发，普通文本（如 sk- 开头的短标识）不误伤
  assert.equal(safeErrorMessage('use sk-abc then continue'), 'use sk-abc then continue');
});
