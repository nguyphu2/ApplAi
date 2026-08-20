var SYNONYMS = {
  first_name: ['first name', 'firstname', 'given name', 'fname'],
  last_name: ['last name', 'lastname', 'surname', 'family name', 'lname'],
  full_name: ['full name', 'fullname', 'your name', 'first and last name', 'legal name', 'applicant name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'telephone', 'mobile', 'cell', 'contact number'],
  city: ['city', 'town'],
  state: ['state', 'province'],
  zip_code: ['zip code', 'zipcode', 'zip', 'postal code'],
  address: ['address', 'street address', 'mailing address'],
  linkedin_url: ['linkedin'],
  portfolio_url: ['portfolio', 'personal website', 'personal site', 'github'],
  work_authorization: ['work authorization', 'work auth', 'sponsorship', 'authorized to work', 'visa status'],
};

function buildHaystack(descriptor) {
  return [descriptor.label, descriptor.name, descriptor.id, descriptor.placeholder]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function haystackContainsTerm(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![a-zA-Z])' + escaped + '(?![a-zA-Z])').test(haystack);
}

// city/state/zip_code/address answer "where do you live" - but the same
// words show up in unrelated repeatable sections like education or work
// history (e.g. an id like "educationHistory.city.0" means "what city was
// your school in", not the user's home city). Skip these four keys
// whenever the haystack signals a different context, rather than filling
// in the user's home address somewhere it doesn't belong.
var HOME_ADDRESS_KEYS = new Set(['city', 'state', 'zip_code', 'address']);
var OTHER_CONTEXT_TERMS = [
  'education', 'school', 'college', 'university',
  'employer', 'company', 'work history', 'workhistory',
];

function matchField(descriptor, profile) {
  const haystack = buildHaystack(descriptor);
  const isOtherContext = OTHER_CONTEXT_TERMS.some((term) => haystack.includes(term));
  for (const [profileKey, terms] of Object.entries(SYNONYMS)) {
    if (isOtherContext && HOME_ADDRESS_KEYS.has(profileKey)) {
      continue;
    }
    if (terms.some((term) => haystackContainsTerm(haystack, term))) {
      const value = profile[profileKey];
      if (value) {
        return { profileKey, value };
      }
    }
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { matchField, buildHaystack, haystackContainsTerm, SYNONYMS, HOME_ADDRESS_KEYS, OTHER_CONTEXT_TERMS };
}
