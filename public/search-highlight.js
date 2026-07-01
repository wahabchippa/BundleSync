(() => {
  const HIGHLIGHT_MARK_ATTR = 'data-bundlesync-search-mark';
  const HIT_CLASS = 'bundlesync-search-hit';

  const state = {
    currentTerm: '',
    lastScrolledTerm: '',
    debounceTimer: null,
    observerStarted: false
  };

  function injectStyles() {
    if (document.getElementById('bundlesync-search-highlight-styles')) return;

    const style = document.createElement('style');
    style.id = 'bundlesync-search-highlight-styles';
    style.textContent = `
      mark[${HIGHLIGHT_MARK_ATTR}="1"] {
        background: #fef08a !important;
        color: #111827 !important;
        padding: 0 2px !important;
        border-radius: 3px !important;
      }

      .${HIT_CLASS} {
        outline: 2px solid #f59e0b !important;
        outline-offset: -2px !important;
        box-shadow: inset 0 0 0 9999px rgba(245, 158, 11, 0.08) !important;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function normalizeTerm(v) {
    return String(v || '').trim();
  }

  function isSearchInput(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return false;

    const type = String(el.type || '').toLowerCase();
    const id = String(el.id || '').toLowerCase();
    const cls = String(el.className || '').toLowerCase();
    const name = String(el.name || '').toLowerCase();
    const ph = String(el.placeholder || '').toLowerCase();

    return (
      type === 'search' ||
      id.includes('search') ||
      cls.includes('search') ||
      name.includes('search') ||
      ph.includes('search') ||
      ph.includes('order') ||
      ph.includes('fleek')
    );
  }

  function clearHighlights() {
    document.querySelectorAll(`mark[${HIGHLIGHT_MARK_ATTR}="1"]`).forEach(mark => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(mark.textContent), mark);
      parent.normalize();
    });

    document.querySelectorAll('.' + HIT_CLASS).forEach(el => {
      el.classList.remove(HIT_CLASS);
    });
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
  }

  function findRowContainer(el) {
    if (!el) return null;
    return el.closest('tr, .order-row, .bundle-row, .table-row, .order-card, .bundle-card, .card, li');
  }

  function highlightTerm(term, shouldScroll) {
    clearHighlights();

    if (!term) {
      state.lastScrolledTerm = '';
      return;
    }

    injectStyles();

    const safe = escapeRegExp(term);
    const regex = new RegExp(safe, 'ig');
    const textNodes = [];

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (!isVisible(parent)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('script, style, noscript, textarea, input, select, option, button')) {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.closest(`mark[${HIGHLIGHT_MARK_ATTR}="1"]`)) {
            return NodeFilter.FILTER_REJECT;
          }

          regex.lastIndex = 0;
          if (!regex.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node);
    }

    let firstMark = null;

    textNodes.forEach(textNode => {
      const text = textNode.nodeValue;
      regex.lastIndex = 0;

      let lastIndex = 0;
      let match;
      const frag = document.createDocumentFragment();
      let hasMatch = false;

      while ((match = regex.exec(text)) !== null) {
        hasMatch = true;

        const before = text.slice(lastIndex, match.index);
        if (before) frag.appendChild(document.createTextNode(before));

        const mark = document.createElement('mark');
        mark.setAttribute(HIGHLIGHT_MARK_ATTR, '1');
        mark.textContent = match[0];
        frag.appendChild(mark);

        if (!firstMark) firstMark = mark;

        const row = findRowContainer(textNode.parentElement);
        if (row) row.classList.add(HIT_CLASS);

        lastIndex = match.index + match[0].length;
      }

      if (!hasMatch) return;

      const after = text.slice(lastIndex);
      if (after) frag.appendChild(document.createTextNode(after));

      textNode.parentNode.replaceChild(frag, textNode);
    });

    if (shouldScroll && firstMark && state.lastScrolledTerm !== term) {
      state.lastScrolledTerm = term;
      firstMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function scheduleHighlight(term, shouldScroll) {
    state.currentTerm = normalizeTerm(term);

    clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => {
      highlightTerm(state.currentTerm, !!shouldScroll);
    }, 180);
  }

  function captureExistingSearchValue() {
    const inputs = Array.from(document.querySelectorAll('input, textarea')).filter(isSearchInput);
    const filled = inputs.find(i => normalizeTerm(i.value));
    if (filled) {
      state.currentTerm = normalizeTerm(filled.value);
      highlightTerm(state.currentTerm, false);
    }
  }

  function startObserver() {
    if (state.observerStarted) return;
    state.observerStarted = true;

    const observer = new MutationObserver(() => {
      if (state.currentTerm) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(() => {
          highlightTerm(state.currentTerm, false);
        }, 250);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  document.addEventListener('input', (e) => {
    if (isSearchInput(e.target)) {
      scheduleHighlight(e.target.value, true);
    }
  }, true);

  document.addEventListener('change', (e) => {
    if (isSearchInput(e.target)) {
      scheduleHighlight(e.target.value, true);
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      injectStyles();
      startObserver();
      captureExistingSearchValue();
    });
  } else {
    injectStyles();
    startObserver();
    captureExistingSearchValue();
  }
})();