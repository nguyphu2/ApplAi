(function () {
  // Same phrase list background.js's detectJobDescriptionPage checks for -
  // if this page was flagged as a job posting at all, at least two of these
  // appear somewhere in its text, so the block that actually contains them
  // is a much more reliable signal of "this is the posting" than raw size:
  // many ATS pages (Rippling, Greenhouse, Lever) fragment the real
  // description across deeply nested elements with little direct text of
  // their own, so a pure "largest own-text block" heuristic can latch onto
  // a small, unrelated block (e.g. a location chip) instead.
  const POSTING_TERMS = [
    'responsibilities', 'requirements', 'qualifications', 'job description',
    'what you\'ll do', 'what you will do', 'about the role', 'about this role',
    'we are looking for', "we're looking for", 'skills and experience',
  ];

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
  }

  function termHitCount(text) {
    const lower = text.toLowerCase();
    return POSTING_TERMS.filter((term) => lower.includes(term)).length;
  }

  function bestJobPostingBlock() {
    const blockTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'P'];
    let best = null;
    let bestHits = 0;
    let bestLength = 0;
    for (const el of document.querySelectorAll(blockTags.join(','))) {
      if (!isVisible(el)) continue;
      const text = el.textContent.trim();
      if (text.length < 200) continue;
      const hits = termHitCount(text);
      if (hits === 0) continue;
      // Prefer the block matching the most posting terms; among ties,
      // prefer the smallest (most specific) container, since any larger
      // ancestor always inherits every hit its descendants already have.
      if (hits > bestHits || (hits === bestHits && text.length < bestLength)) {
        best = el;
        bestHits = hits;
        bestLength = text.length;
      }
    }
    return best ? best.textContent.trim() : null;
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

  // Fallback for the rare page that was flagged as a posting but whose
  // matching terms never land inside a single 200+ char block (e.g. split
  // across sibling elements) - falls back to the old largest-own-text-block
  // heuristic, then to the whole page as a last resort.
  function largestTextBlock() {
    const blockTags = ['DIV', 'SECTION', 'ARTICLE', 'MAIN', 'P'];
    let best = null;
    let bestLength = 0;
    for (const el of document.querySelectorAll(blockTags.join(','))) {
      if (!isVisible(el)) continue;
      const text = el.textContent.trim();
      if (text.length <= bestLength) continue;
      const ratio = text.length > 0 ? ownText(el).length / text.length : 0;
      if (ratio < 0.3 && el.children.length > 0) continue;
      best = el;
      bestLength = text.length;
    }
    return best ? best.textContent.trim() : document.body.textContent.trim();
  }

  const text = (bestJobPostingBlock() || largestTextBlock()).slice(0, 20000);
  chrome.runtime.sendMessage({ type: 'JOB_DESCRIPTION_SCRAPED', text, pageTitle: document.title });
})();
