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
  const PHRASE_CATEGORY = {
    'add education': 'education',
    'add another education': 'education',
    'add work history': 'work_history',
    'add employment': 'work_history',
    'add experience': 'work_history',
    'add another job': 'work_history',
    'add certification': 'other',
    'add license': 'other',
  };
  const EXPANDABLE_BUTTON_PHRASES = Object.keys(PHRASE_CATEGORY);

  function isExpandableButton(button) {
    const text = button.textContent.trim().toLowerCase();
    return EXPANDABLE_BUTTON_PHRASES.some((phrase) => text === phrase || text.includes(phrase));
  }

  function matchedPhrase(text) {
    return EXPANDABLE_BUTTON_PHRASES.find((phrase) => text === phrase || text.includes(phrase));
  }

  // How many blocks to reveal comes from Claude's read of the actual
  // resume (see getSectionCounts in background.js) - a resume with 2
  // degrees needs 2 education blocks, not a guessed flat number, and one
  // with none shouldn't get an empty block opened at all. "other"
  // (certifications/licenses) has no counting signal from the resume, so
  // it keeps a small fixed cap.
  const sectionCounts = window.__applaiSectionCounts || {};
  function maxClicksForCategory(category) {
    if (category === 'education') return sectionCounts.education || 0;
    if (category === 'work_history') return sectionCounts.work_history || 0;
    return 1;
  }

  // Persisted on window (survives across separate Fill clicks on the same
  // page load, since content.js is re-injected fresh each time but window
  // state is not) so a repeat Fill click doesn't keep adding more blank
  // entries on top of ones already revealed. Counted per category, not
  // per exact button text, so a page using two differently-worded buttons
  // for the same section (e.g. "Add Employment" and "Add Experience")
  // still can't exceed that section's count between them.
  window.__applaiExpandCategoryClicks = window.__applaiExpandCategoryClicks || {};

  // Some sites only reveal the button for the *next* entry ("Add another
  // education") after the previous one's already been clicked, so a
  // single snapshot-and-click pass never sees it. Re-querying after each
  // click, and allowing the same button text to be clicked multiple times
  // up to its category's count, covers both "same button repeatable" and
  // "a new button appears" sites.
  let addedBlock = true;
  let safety = 0;
  while (addedBlock && safety < 20) {
    addedBlock = false;
    safety += 1;
    const expandButtons = Array.from(document.querySelectorAll('button')).filter(isExpandableButton);
    for (const button of expandButtons) {
      const text = button.textContent.trim().toLowerCase();
      const category = PHRASE_CATEGORY[matchedPhrase(text)];
      const clicks = window.__applaiExpandCategoryClicks[category] || 0;
      if (clicks >= maxClicksForCategory(category)) {
        continue;
      }
      window.__applaiExpandCategoryClicks[category] = clicks + 1;
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

    // Some INPUT-tagged "comboboxes" are really just free-text fields with
    // type-ahead suggestions (e.g. Google Places-style address autocomplete)
    // - their aria-controls/aria-owns target only gets created once the
    // user starts typing, so at scan time there's no listbox and no
    // options at all. Routing these through the dropdown-only path would
    // send an empty option list to Claude, and the backend's own "value
    // must be one of the listed options" check would then reject anything
    // it tries - silently leaving the field blank forever. Fall back to
    // treating it exactly like a plain text input instead.
    if (combo.tagName === 'INPUT' && options.length === 0) {
      if (isExcludedField(labelText, combo.name || '', combo.id || '')) {
        continue;
      }
      const descriptor = { label: labelText, name: combo.name || '', id: combo.id || '', placeholder: combo.placeholder || '' };
      const match = matchField(descriptor, profile);
      if (match) {
        fillField(combo, match.value);
        filled += 1;
        if (required) {
          requiredFilled += 1;
        }
      } else {
        const fieldId = 'applai-field-' + runId + '-' + nextFieldId;
        nextFieldId += 1;
        combo.setAttribute('data-applai-field-id', fieldId);
        unmatched.push({
          field_id: fieldId,
          label: descriptor.label,
          name: descriptor.name,
          id: descriptor.id,
          placeholder: descriptor.placeholder,
          type: 'text',
          required,
        });
      }
      continue;
    }

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
