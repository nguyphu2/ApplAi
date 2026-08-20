(async function () {
  const profile = window.__applaiProfile || {};

  document.querySelectorAll('[data-applai-field-id]').forEach((el) => {
    el.removeAttribute('data-applai-field-id');
  });

  const runId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Some sections (education, work history) start collapsed behind an
  // "Add X" button and have no fields in the DOM at all until clicked.
  // Deliberately narrow allowlist rather than a generic "anything
  // expandable" heuristic - a broad heuristic risks clicking something
  // destructive or unrelated (submit, navigate away, an unrelated modal).
  const EXPANDABLE_BUTTON_PHRASES = [
    'add education', 'add work history', 'add employment', 'add experience',
    'add another education', 'add another job', 'add certification', 'add license',
  ];

  function isExpandableButton(button) {
    const text = button.textContent.trim().toLowerCase();
    return EXPANDABLE_BUTTON_PHRASES.some((phrase) => text === phrase || text.includes(phrase));
  }

  const expandButtons = Array.from(document.querySelectorAll('button')).filter(isExpandableButton);
  for (const button of expandButtons) {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  function getLabelText(input) {
    if (input.labels && input.labels.length > 0) {
      return input.labels[0].textContent.trim();
    }
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    // Some ATS platforms (e.g. Paylocity) render the visible label text
    // elsewhere in the DOM and only expose it via a non-standard data-for
    // attribute on the input itself, rather than a real <label> or
    // aria-label - this is the fallback for that pattern.
    const dataFor = input.getAttribute('data-for');
    return dataFor || '';
  }

  function isRequiredField(input, labelText) {
    return input.required || input.getAttribute('aria-required') === 'true' || labelText.includes('*');
  }

  function fillField(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea';
  const fields = Array.from(document.querySelectorAll(SELECTOR));

  let filled = 0;
  let requiredTotal = 0;
  let requiredFilled = 0;
  const unmatched = [];
  let nextFieldId = 0;

  for (const field of fields) {
    const labelText = getLabelText(field);
    const required = isRequiredField(field, labelText);
    if (required) {
      requiredTotal += 1;
    }

    if (field.value.trim()) {
      if (required) {
        requiredFilled += 1;
      }
      continue;
    }
    const descriptor = {
      label: labelText,
      name: field.name || '',
      id: field.id || '',
      placeholder: field.placeholder || '',
    };
    const match = matchField(descriptor, profile);
    if (match) {
      fillField(field, match.value);
      filled += 1;
      if (required) {
        requiredFilled += 1;
      }
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
        required,
      });
    }
  }

  chrome.runtime.sendMessage({
    type: 'LOCAL_FILL_DONE',
    filled,
    total: fields.length,
    requiredTotal,
    requiredFilled,
    unmatched,
    pageUrl: window.location.href,
    pageTitle: document.title,
  });
})();
