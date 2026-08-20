(function () {
  const profile = window.__applaiProfile || {};

  document.querySelectorAll('[data-applai-field-id]').forEach((el) => {
    el.removeAttribute('data-applai-field-id');
  });

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function getLabelText(input) {
    if (input.labels && input.labels.length > 0) {
      return input.labels[0].textContent.trim();
    }
    const ariaLabel = input.getAttribute('aria-label');
    return ariaLabel || '';
  }

  function fillField(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea';
  const fields = Array.from(document.querySelectorAll(SELECTOR));

  let filled = 0;
  const unmatched = [];
  let nextFieldId = 0;

  for (const field of fields) {
    if (field.value.trim()) {
      continue;
    }
    const descriptor = {
      label: getLabelText(field),
      name: field.name || '',
      id: field.id || '',
      placeholder: field.placeholder || '',
    };
    const match = matchField(descriptor, profile);
    if (match) {
      fillField(field, match.value);
      filled += 1;
    } else {
      const fieldId = 'applai-field-' + runId + '-' + nextFieldId;
      nextFieldId += 1;
      field.setAttribute('data-applai-field-id', fieldId);
      unmatched.push({
        field_id: fieldId,
        label: descriptor.label,
        name: descriptor.name,
        id: descriptor.id,
        placeholder: descriptor.placeholder,
        type: field.tagName === 'TEXTAREA' ? 'textarea' : field.type,
      });
    }
  }

  chrome.runtime.sendMessage({
    type: 'LOCAL_FILL_DONE',
    filled,
    total: fields.length,
    unmatched,
    pageUrl: window.location.href,
    pageTitle: document.title,
  });
})();
