(function () {
  // Finds the single largest block of visible text on the page - good
  // enough to grab a job description without needing site-specific
  // selectors, since posting text is reliably the largest coherent block
  // on a job description page (job title, requirements, responsibilities).
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function largestTextBlock() {
    const blockTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'P'];
    let best = null;
    let bestLength = 0;
    for (const el of document.querySelectorAll(blockTags.join(','))) {
      if (!isVisible(el)) continue;
      // Only consider elements whose OWN direct text (not a descendant's,
      // to avoid re-counting the same text once per ancestor level) makes
      // up a meaningful share of what's inside them - otherwise the
      // largest match is always <body> or another oversized wrapper.
      const text = el.textContent.trim();
      if (text.length > bestLength) {
        best = el;
        bestLength = text.length;
      }
    }
    return best ? best.textContent.trim() : document.body.textContent.trim();
  }

  const text = largestTextBlock().slice(0, 20000);
  chrome.runtime.sendMessage({ type: 'JOB_DESCRIPTION_SCRAPED', text, pageTitle: document.title });
})();
