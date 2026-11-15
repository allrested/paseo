// The page side of browser.cdp.view.pick_element. Adapted from the desktop pane's selector
// (buildElementSelectorScript in packages/app/src/desktop/browser/pane/element-selector.electron.ts),
// which the daemon cannot import: the outline, the label and the element's description are the
// same, so an element picked here reads to an agent as one picked in the desktop app. What differs
// is marked "CDP:".
//
// The scripts run in the page's own world, so everything they return is the page's word.

/**
 * Makes the page a picker. Evaluates to `{ installed: true, sessionToken }`, or to
 * `{ installed: false, reason: "document-loading", sessionToken }` for a page with no document yet.
 */
export function elementPickInstallScript(token: string): string {
  return `
    (function() {
      var sessionToken = ${JSON.stringify(token)};
      if (document.readyState === 'loading' || !document.head || !document.documentElement) {
        return { installed: false, reason: 'document-loading', sessionToken: sessionToken };
      }
      if (window.__paseoSelector) { window.__paseoSelector.destroy(); }
      window.__paseoSelectorResult = null;
      var style = document.createElement('style');
      style.textContent = [
        '.__paseo-hover { outline: 2px solid #3b82f6 !important; outline-offset: 2px !important; cursor: crosshair !important; }',
        '.__paseo-select-mode, .__paseo-select-mode * { cursor: crosshair !important; pointer-events: auto !important; user-select: none !important; }',
        '.__paseo-select-mode *, .__paseo-select-mode *::before, .__paseo-select-mode *::after { animation: none !important; transition: none !important; }',
        // CDP: links, buttons and fields stay pickable. The desktop selector turns their pointer
        // events off, so a press on one picks whatever lies behind it; the listeners below already
        // stop the press from doing anything.
        '.__paseo-select-mode iframe, .__paseo-select-mode video, .__paseo-select-mode audio { pointer-events: none !important; }',
        '.__paseo-hover-label { position: fixed; z-index: 2147483647; pointer-events: none !important; max-width: 360px; padding: 4px 8px; border-radius: 6px; background: rgba(24,24,27,0.96); color: #fff; font: 500 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; box-shadow: 0 2px 10px rgba(0,0,0,0.35); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
        '.__paseo-hover-label .__paseo-tag { color: #93c5fd; }',
        '.__paseo-hover-label .__paseo-id { color: #fca5a5; }',
        '.__paseo-hover-label .__paseo-cls { color: #fcd34d; }',
        '.__paseo-hover-label .__paseo-dim { color: #a1a1aa; margin-left: 6px; }',
        '.__paseo-hover-label .__paseo-comp { color: #86efac; margin-left: 6px; }',
      ].join('\\n');
      document.head.appendChild(style);
      document.documentElement.classList.add('__paseo-select-mode');
      var hoverLabel = document.createElement('div');
      hoverLabel.className = '__paseo-hover-label';
      hoverLabel.style.display = 'none';
      document.documentElement.appendChild(hoverLabel);
      var last = null;
      function escapeHtml(value) {
        return String(value).replace(/[&<>"]/g, function(ch) {
          return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;';
        });
      }
      function describeElement(el) {
        var tag = el.tagName ? el.tagName.toLowerCase() : 'node';
        var parts = ['<span class="__paseo-tag">' + escapeHtml(tag) + '</span>'];
        if (el.id) {
          parts.push('<span class="__paseo-id">#' + escapeHtml(el.id) + '</span>');
        }
        if (el.classList && el.classList.length) {
          var cls = Array.prototype.slice.call(el.classList, 0, 2)
            .filter(function(c) { return c.indexOf('__paseo') !== 0; })
            .map(function(c) { return '.' + escapeHtml(c); })
            .join('');
          if (cls) parts.push('<span class="__paseo-cls">' + cls + '</span>');
        }
        var comp = getReactSource(el);
        if (comp && comp.componentName) {
          parts.push('<span class="__paseo-comp">&lt;' + escapeHtml(comp.componentName) + '&gt;</span>');
        }
        var rect = el.getBoundingClientRect();
        parts.push('<span class="__paseo-dim">' + Math.round(rect.width) + '×' + Math.round(rect.height) + '</span>');
        return { html: parts.join(''), rect: rect };
      }
      function positionLabel(rect, e) {
        var lw = hoverLabel.offsetWidth || 0;
        var lh = hoverLabel.offsetHeight || 0;
        var top = rect.top - lh - 6;
        if (top < 4) top = rect.bottom + 6;
        if (top + lh > window.innerHeight - 4) top = Math.max(4, e.clientY - lh - 6);
        var left = rect.left;
        if (left + lw > window.innerWidth - 4) left = Math.max(4, window.innerWidth - lw - 4);
        if (left < 4) left = 4;
        hoverLabel.style.top = Math.round(top) + 'px';
        hoverLabel.style.left = Math.round(left) + 'px';
      }
      // CDP: an event's target may be a text node's parent only; anything that is no element
      // (the document itself) is not picked.
      function elementOf(e) {
        var el = e.target;
        return el && el.nodeType === 1 && el !== hoverLabel ? el : null;
      }
      function onMove(e) {
        e.preventDefault();
        e.stopPropagation();
        if (last) last.classList.remove('__paseo-hover');
        var el = elementOf(e);
        if (!el) { last = null; hoverLabel.style.display = 'none'; return; }
        el.classList.add('__paseo-hover');
        last = el;
        try {
          var info = describeElement(el);
          hoverLabel.innerHTML = info.html;
          hoverLabel.style.display = 'block';
          positionLabel(info.rect, e);
        } catch (err) {
          hoverLabel.style.display = 'none';
        }
      }
      function buildSelector(el) {
        if (el.id) return '#' + el.id;
        var path = [];
        while (el && el.nodeType === 1) {
          var seg = el.tagName.toLowerCase();
          if (el.id) { path.unshift('#' + el.id); break; }
          var sib = el, nth = 1;
          while (sib = sib.previousElementSibling) { if (sib.tagName === el.tagName) nth++; }
          if (nth > 1) seg += ':nth-of-type(' + nth + ')';
          path.unshift(seg);
          el = el.parentElement;
        }
        return path.join(' > ');
      }
      function getReactSource(el) {
        var keys = Object.keys(el);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].startsWith('__reactFiber$') || keys[i].startsWith('__reactInternalInstance$')) {
            var fiber = el[keys[i]];
            while (fiber) {
              if (fiber._debugSource) {
                return {
                  fileName: fiber._debugSource.fileName || null,
                  lineNumber: fiber._debugSource.lineNumber || null,
                  columnNumber: fiber._debugSource.columnNumber || null,
                  componentName: (fiber.type && (typeof fiber.type === 'string' ? fiber.type : fiber.type.displayName || fiber.type.name)) || null
                };
              }
              if (fiber._debugOwner) { fiber = fiber._debugOwner; }
              else if (fiber.return) { fiber = fiber.return; }
              else break;
            }
          }
        }
        return null;
      }
      function getParentChain(el, depth) {
        var chain = [];
        var cur = el.parentElement;
        for (var i = 0; i < (depth || 5) && cur; i++) {
          var desc = cur.tagName.toLowerCase();
          if (cur.id) desc += '#' + cur.id;
          if (cur.className && typeof cur.className === 'string') { var cls = cur.className.trim().replace(/  +/g, ' ').split(' ').slice(0,2).join('.'); if (cls) desc += '.' + cls; }
          chain.push(desc);
          cur = cur.parentElement;
        }
        return chain;
      }
      function getChildSummary(el, max) {
        var kids = [];
        for (var i = 0; i < Math.min(el.children.length, max || 8); i++) {
          var c = el.children[i];
          var desc = c.tagName.toLowerCase();
          if (c.id) desc += '#' + c.id;
          kids.push(desc);
        }
        if (el.children.length > (max || 8)) kids.push('...(' + el.children.length + ' total)');
        return kids;
      }
      function getRelevantStyles(el) {
        var cs = window.getComputedStyle(el);
        var pick = ['display','position','width','height','color','background-color','font-size','font-family','padding','margin','border','flex','grid-template-columns','gap','overflow','opacity','z-index'];
        var out = {};
        pick.forEach(function(p) {
          var v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') out[p] = v;
        });
        return out;
      }
      function onClick(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        var el = elementOf(e);
        if (!el) return;
        if (last) last.classList.remove('__paseo-hover');
        hoverLabel.style.display = 'none';
        // CDP: the picker's own marks are taken off before the element is read, so neither its
        // HTML nor its styles (the crosshair, the outline) describe the picker.
        destroy();
        var rect = el.getBoundingClientRect();
        var result = {
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').substring(0, 500),
          selector: buildSelector(el),
          url: location.href,
          outerHTML: el.outerHTML.substring(0, 2000),
          computedStyles: getRelevantStyles(el),
          __paseoSessionToken: sessionToken,
          boundingRect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
          reactSource: getReactSource(el),
          parentChain: getParentChain(el, 5),
          children: getChildSummary(el, 8)
        };
        window.__paseoSelectorResult = result;
      }
      function onKey(e) {
        if (e.key === 'Escape') {
          destroy();
          window.__paseoSelectorResult = { __cancelled: true, __paseoSessionToken: sessionToken };
        }
      }
      function blockEvent(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      }
      var blocked = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'focus', 'submit'];
      function destroy() {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        blocked.forEach(function(name) { document.removeEventListener(name, blockEvent, true); });
        document.documentElement.classList.remove('__paseo-select-mode');
        if (last) last.classList.remove('__paseo-hover');
        if (last && last.getAttribute('class') === '') last.removeAttribute('class');
        if (hoverLabel.parentNode) hoverLabel.parentNode.removeChild(hoverLabel);
        style.remove();
        window.__paseoSelector = null;
      }
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
      blocked.forEach(function(name) { document.addEventListener(name, blockEvent, true); });
      window.__paseoSelector = { destroy: destroy, sessionToken: sessionToken };
      return { installed: true, sessionToken: sessionToken };
    })()
  `;
}

/**
 * Reads how the pick stands. Evaluates to null while the page waits for a click, else to a JSON
 * text: the picked element, or `{ "__cancelled": true }` when Escape ended the pick or the picker
 * is gone without a result (the page navigated, or another pick took the page over).
 */
export function elementPickPollScript(token: string): string {
  return `
    (function() {
      var token = ${JSON.stringify(token)};
      var result = window.__paseoSelectorResult;
      if (result && result.__paseoSessionToken === token) {
        window.__paseoSelectorResult = null;
        return JSON.stringify(result);
      }
      if (!window.__paseoSelector || window.__paseoSelector.sessionToken !== token) {
        return JSON.stringify({ __cancelled: true });
      }
      return null;
    })()
  `;
}

/** Ends this pick on the page, if it is still the page's picker, and drops its result. */
export function elementPickClearScript(token: string): string {
  const quoted = JSON.stringify(token);
  return `
    (function() {
      if (window.__paseoSelector && window.__paseoSelector.sessionToken === ${quoted}) window.__paseoSelector.destroy();
      if (window.__paseoSelectorResult && window.__paseoSelectorResult.__paseoSessionToken === ${quoted}) window.__paseoSelectorResult = null;
    })()
  `;
}
