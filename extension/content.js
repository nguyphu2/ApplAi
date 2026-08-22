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

  // Persisted on window (survives across separate Fill clicks on the same
  // page load, since content.js is re-injected fresh each time but window
  // state is not) so a repeat Fill click doesn't keep adding more blank
  // entries on top of ones already revealed.
  window.__applaiExpandButtonClicks = window.__applaiExpandButtonClicks || {};

  // A resume with 2 degrees or 3 past jobs needs 2-3 blocks, not 1 - and
  // some sites only reveal the button for the *next* entry ("Add another
  // education") after the previous one's already been clicked, so a
  // single snapshot-and-click pass never sees it. Re-querying after each
  // click, and allowing the same button text to be clicked multiple times
  // (capped, so this can't loop forever or over-add on a plain resume),
  // covers both "same button repeatable" and "a new button appears" sites.
  const MAX_CLICKS_PER_PHRASE = 4;
  let addedBlock = true;
  let safety = 0;
  while (addedBlock && safety < 20) {
    addedBlock = false;
    safety += 1;
    const expandButtons = Array.from(document.querySelectorAll('button')).filter(isExpandableButton);
    for (const button of expandButtons) {
      const key = button.textContent.trim().toLowerCase();
      const clicks = window.__applaiExpandButtonClicks[key] || 0;
      if (clicks >= MAX_CLICKS_PER_PHRASE) {
        continue;
      }
      window.__applaiExpandButtonClicks[key] = clicks + 1;
      button.click();
      addedBlock = true;
      await new Promise((resolve) => setTimeout(resolve, 300));
      break; // the DOM likely just changed - re-query from scratch
    }
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
    if (input.required || input.getAttribute('aria-required') === 'true' || labelText.includes('*')) {
      return true;
    }
    // Some ATS platforms (e.g. Paylocity) mark a required field only via a
    // CSS class on its immediate wrapper (e.g. "form-required") and/or
    // literal " (required)" text in a sibling label, with none of the
    // standard HTML signals above ever set. Scoped to the immediate parent
    // only, so this can't false-positive on an unrelated ancestor further
    // up the page.
    const wrapper = input.parentElement;
    if (!wrapper) {
      return false;
    }
    return /required/i.test(wrapper.className) || /\brequired\b/i.test(wrapper.textContent);
  }

  function fillField(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Option value/text pairs vary too wildly across ATS platforms (state
  // code vs. full name, numeric IDs for a school-type dropdown) for the
  // local synonym matcher to safely guess - every <select> goes to Claude,
  // which gets the actual option list and picks a value from it rather
  // than inventing free text.
  function getSelectOptions(select) {
    return Array.from(select.options)
      .filter((opt) => opt.value !== '')
      .map((opt) => ({ value: opt.value, text: opt.textContent.trim() }));
  }

  // Resumes almost never state a past employer's own phone number or
  // website, so Claude has nothing real to go on for these and tends to
  // invent one - simplest fix is to never attempt them at all, local or
  // remote, and just leave them for the user to fill by hand.
  const EXCLUDED_FIELD_TERMS = ['company website', 'company url', 'companyurl', 'company phone', 'companyphone'];

  function isExcludedField(labelText, name, id) {
    const haystack = (labelText + ' ' + name + ' ' + id).toLowerCase();
    return EXCLUDED_FIELD_TERMS.some((term) => haystack.includes(term));
  }

  // A lot of ATS platforms build "dropdowns" as a JS widget instead of a
  // real <select>, following the standard ARIA combobox pattern: the
  // trigger element (a plain div for widget libraries like react-widgets/
  // Kendo/PrimeNG, or a text input for react-select/MUI Autocomplete/
  // downshift-style pickers) exposes role="combobox" and points at a
  // listbox of role="option" elements via aria-owns or aria-controls - the
  // listbox itself often only exists in the DOM while open. Opening/
  // closing it here just to read state, so the page looks untouched
  // between fill attempts.
  function getComboboxListbox(combo) {
    const listboxId = combo.getAttribute('aria-owns') || combo.getAttribute('aria-controls');
    return listboxId ? document.getElementById(listboxId) : null;
  }

  async function openCombobox(combo) {
    combo.click();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  function closeCombobox(combo) {
    combo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function readComboboxOptions(combo) {
    await openCombobox(combo);
    const listbox = getComboboxListbox(combo);
    const optionEls = listbox ? Array.from(listbox.querySelectorAll('[role="option"]')) : [];
    const options = optionEls.map((opt) => opt.textContent.trim());
    const selectedIndex = optionEls.findIndex((opt) => opt.getAttribute('aria-selected') === 'true');
    closeCombobox(combo);
    return { options, selectedIndex };
  }

  const SELECTOR = 'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input:not([type]), textarea';
  const fields = Array.from(document.querySelectorAll(SELECTOR))
    .filter((el) => el.getAttribute('role') !== 'combobox');
  const selectFields = Array.from(document.querySelectorAll('select'));
  const comboboxFields = Array.from(document.querySelectorAll('[role="combobox"]'))
    .filter((el) => el.tagName !== 'SELECT');

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
    if (isExcludedField(labelText, field.name || '', field.id || '')) {
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

  for (const select of selectFields) {
    const labelText = getLabelText(select);
    const required = isRequiredField(select, labelText);
    if (required) {
      requiredTotal += 1;
    }

    // Many dropdowns have no empty placeholder option, so the browser
    // auto-selects the first real option before the user ever touches it -
    // select.value is truthy in that state even though nothing was
    // actually chosen. selectedIndex === 0 is the untouched/default state
    // in both that case and the "-- Select --" placeholder case, so it's
    // the more reliable signal that this field still needs filling.
    if (select.value && select.selectedIndex !== 0) {
      if (required) {
        requiredFilled += 1;
      }
      continue;
    }
    const fieldId = 'applai-field-' + runId + '-' + nextFieldId;
    nextFieldId += 1;
    select.setAttribute('data-applai-field-id', fieldId);
    unmatched.push({
      field_id: fieldId,
      label: labelText,
      name: select.name || '',
      id: select.id || '',
      placeholder: '',
      type: 'select',
      required,
      options: getSelectOptions(select),
    });
  }

  for (const combo of comboboxFields) {
    const labelText = getLabelText(combo);
    const required = isRequiredField(combo, labelText);
    if (required) {
      requiredTotal += 1;
    }

    // Input-based comboboxes (react-select/MUI Autocomplete/downshift-style
    // pickers) commonly show the chosen option's text as the input's own
    // value rather than via an aria-selected option in the listbox -
    // check that first so an already-answered field isn't reopened.
    if (combo.tagName === 'INPUT' && combo.value.trim()) {
      if (required) {
        requiredFilled += 1;
      }
      continue;
    }

    const { options, selectedIndex } = await readComboboxOptions(combo);
    // Index 0 is this widget's placeholder ("--", "Select...") - matches
    // the same untouched/default convention used for native <select> above.
    if (selectedIndex > 0) {
      if (required) {
        requiredFilled += 1;
      }
      continue;
    }
    const fieldId = 'applai-field-' + runId + '-' + nextFieldId;
    nextFieldId += 1;
    combo.setAttribute('data-applai-field-id', fieldId);
    unmatched.push({
      field_id: fieldId,
      label: labelText,
      name: '',
      id: combo.id || '',
      placeholder: '',
      type: 'combobox',
      required,
      options: options.filter((text) => text && text !== '--').map((text) => ({ value: text, text })),
    });
  }

  chrome.runtime.sendMessage({
    type: 'LOCAL_FILL_DONE',
    filled,
    total: fields.length + selectFields.length + comboboxFields.length,
    requiredTotal,
    requiredFilled,
    unmatched,
    pageUrl: window.location.href,
    pageTitle: document.title,
  });
})();
