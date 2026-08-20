const test = require('node:test');
const assert = require('node:assert/strict');
const { matchField } = require('../matcher.js');

const PROFILE = {
  full_name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '555-0100',
  work_authorization: 'US Citizen',
  city: 'Portland',
  state: 'OR',
  zip_code: '97201',
};

test('matches a field by its label text', () => {
  const result = matchField({ label: 'Full Name', name: 'fname', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'full_name', value: 'Ada Lovelace' });
});

test('matches a First Name field to first_name, not full_name', () => {
  const profileWithNames = { ...PROFILE, first_name: 'Ada', last_name: 'Lovelace' };
  const result = matchField({ label: 'First Name', name: 'firstName', id: '', placeholder: '' }, profileWithNames);
  assert.deepEqual(result, { profileKey: 'first_name', value: 'Ada' });
});

test('matches a Last Name field to last_name', () => {
  const profileWithNames = { ...PROFILE, first_name: 'Ada', last_name: 'Lovelace' };
  const result = matchField({ label: 'Last Name', name: 'lastName', id: '', placeholder: '' }, profileWithNames);
  assert.deepEqual(result, { profileKey: 'last_name', value: 'Lovelace' });
});

test('a full-name field still matches full_name even when first_name/last_name are also set', () => {
  const profileWithNames = { ...PROFILE, first_name: 'Ada', last_name: 'Lovelace' };
  const result = matchField({ label: 'Full Name', name: 'fullName', id: '', placeholder: '' }, profileWithNames);
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

test('does not false-fill a firstName field with the full name (word-boundary check)', () => {
  const result = matchField({ label: 'First Name', name: 'firstName', id: '', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});

test('does not false-fill a companyName field with the full name', () => {
  const result = matchField({ label: 'Company Name', name: 'companyName', id: '', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});

test('matches a City field', () => {
  const result = matchField({ label: 'City', name: '', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'city', value: 'Portland' });
});

test('matches a State field', () => {
  const result = matchField({ label: 'State', name: '', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'state', value: 'OR' });
});

test('matches a Zip code field', () => {
  const result = matchField({ label: '', name: '', id: '', placeholder: 'Zip code' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'zip_code', value: '97201' });
});

test('a zip field nested under an "address" name attribute matches zip_code, not address (precedence regression)', () => {
  const result = matchField({ label: 'Zip Code', name: 'address[zip]', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'zip_code', value: '97201' });
});

test('a state field nested under a "mailing address" name attribute matches state, not address', () => {
  const result = matchField({ label: 'State', name: 'mailing_address_state', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'state', value: 'OR' });
});

test('a city field nested under an "address" id attribute matches city, not address', () => {
  const result = matchField({ label: 'City', name: '', id: 'address-city', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'city', value: 'Portland' });
});

test('a genuine street-address field still matches address when no more-specific term is present', () => {
  const PROFILE_WITH_ADDRESS = { ...PROFILE, address: '123 Analytical Engine Way' };
  const result = matchField({ label: 'Street Address', name: 'address_line1', id: '', placeholder: '' }, PROFILE_WITH_ADDRESS);
  assert.deepEqual(result, { profileKey: 'address', value: '123 Analytical Engine Way' });
});

test('does not false-fill a "estate" or "statement" field via the bare state/zip synonyms', () => {
  const result = matchField({ label: 'Estate Planning Notes', name: 'statementField', id: '', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});

test('does not fill home city into an education-history city field (real-world Paylocity id pattern)', () => {
  const result = matchField({ label: 'City', name: '', id: 'educationHistory.city.0', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});

test('does not fill home state into a work-history state field', () => {
  const result = matchField({ label: 'State', name: '', id: 'workHistory.state.1', placeholder: '' }, PROFILE);
  assert.equal(result, null);
});

test('does not fill home address into a school address field', () => {
  const PROFILE_WITH_ADDRESS = { ...PROFILE, address: '123 Analytical Engine Way' };
  const result = matchField({ label: 'Address', name: '', id: 'educationHistory.address.0', placeholder: '' }, PROFILE_WITH_ADDRESS);
  assert.equal(result, null);
});

test('a genuine home city field with no other-context signal still matches (no regression from the exclusion guard)', () => {
  const result = matchField({ label: 'City', name: 'homeCity', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'city', value: 'Portland' });
});

test('can be injected twice without redeclaration errors (regression for SyntaxError on double-injection)', () => {
  delete require.cache[require.resolve('../matcher.js')];
  require('../matcher.js');
  delete require.cache[require.resolve('../matcher.js')];
  const second = require('../matcher.js');
  const result = second.matchField({ label: 'Full Name', name: '', id: '', placeholder: '' }, PROFILE);
  assert.deepEqual(result, { profileKey: 'full_name', value: 'Ada Lovelace' });
});
