var SYNONYMS = {
  full_name: ['full name', 'fullname', 'your name', 'first and last name', 'legal name', 'applicant name'],
  email: ['email', 'e-mail', 'email address'],
  phone: ['phone', 'telephone', 'mobile', 'cell', 'contact number'],
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

function matchField(descriptor, profile) {
  const haystack = buildHaystack(descriptor);
  for (const [profileKey, terms] of Object.entries(SYNONYMS)) {
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
  module.exports = { matchField, buildHaystack, haystackContainsTerm, SYNONYMS };
}
