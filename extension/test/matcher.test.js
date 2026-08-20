const test = require('node:test');
const assert = require('node:assert/strict');
const { matchField } = require('../matcher.js');

const PROFILE = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '555-0100',
  work_authorization: 'US Citizen',
};

test('matches a field by its label text', () => {
  const result = matchField({ label: 'Full Name', name: 'fname', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'full_name', value: 'Ada Lovelace' });
});

test('matches a field by its name attribute when label is missing', () => {
  const result = matchField({ label: '', name: 'email_address', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'email', value: 'ada@example.com' });
});

test('matches by placeholder text', () => {
  const result = matchField({ label: '', name: '', id: '', placeholder: 'Your phone number' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'phone', value: '555-0100' });
});

test('returns null when nothing in the field text matches any synonym', () => {
  const result = matchField({ label: 'Favorite color', name: '', id: '', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});

test('returns null when a synonym matches but the profile has no value for that field', () => {
  const result = matchField({ label: 'LinkedIn URL', name: '', id: '', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});
