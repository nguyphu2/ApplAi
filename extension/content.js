(function () {
  const profile = window.__applaiProfile || {};

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

  const SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], input:not([type]), textarea';
  const fields = Array.from(document.querySelectorAll(SELECTOR));

  let filled = 0;
  for (const field of fields) {
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
    }
  }

  chrome.runtime.sendMessage({ type: 'FILL_RESULT', filled, total: fields.length });
})();
