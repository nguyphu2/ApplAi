(function () {
  // Finds the single largest block of visible text on the page - good
  // enough to grab a job description without needing site-specific
  // selectors, since posting text is reliably the largest coherent block
  // on a job description page (job title, requirements, responsibilities).
  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    }
    return text.trim();
  }

  function largestTextBlock() {
    const blockTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'P'];
    let best = null;
    let bestLength = 0;
    for (const el of document.querySelectorAll(blockTags.join(','))) {
      if (!isVisible(el)) continue;
      const text = el.textContent.trim();
      if (text.length <= bestLength) continue;
      // A large element whose OWN text is tiny is just a wrapper around
      // other blocks (nav, body, a page-level container) - require most of
      // its length to come from its own text, not descendants, so the
      // winner is an actual content block (like a job description), not
      // the largest ancestor wrapper.
      const ratio = text.length > 0 ? ownText(el).length / text.length : 0;
      if (ratio < 0.3 && el.children.length > 0) continue;
      best = el;
      bestLength = text.length;
    }
    return best ? best.textContent.trim() : document.body.textContent.trim();
  }

  const text = largestTextBlock().slice(0, 20000);
  chrome.runtime.sendMessage({ type: 'JOB_DESCRIPTION_SCRAPED', text, pageTitle: document.title });
})();
