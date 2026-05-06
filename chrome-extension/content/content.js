(() => {
  function extractSSLInfo() {
    return {
      valid: window.location.protocol === 'https:',
      issuer: null
    };
  }

  function extractForms() {
    return Array.from(document.forms).map(form => {
      let action = form.action || '';
      let actionIsExternal = false;
      try {
        if (action && action !== window.location.href) {
          const actionUrl = new URL(action, window.location.href);
          actionIsExternal = actionUrl.hostname !== window.location.hostname;
        }
      } catch {
        actionIsExternal = false;
      }
      return {
        action: action.slice(0, 200),
        actionIsExternal,
        hasPasswordField: !!form.querySelector('[type="password"]'),
        hasRUTField: !!form.querySelector(
          '[name*="rut"], [name*="cedula"], [name*="dni"], [id*="rut"], [placeholder*="RUT"]'
        )
      };
    });
  }

  function extractExternalScripts() {
    return Array.from(document.scripts)
      .filter(s => {
        if (!s.src) return false;
        try { return new URL(s.src).hostname !== window.location.hostname; } catch { return false; }
      })
      .map(s => { try { return new URL(s.src).hostname; } catch { return ''; } })
      .filter(Boolean)
      .slice(0, 20);
  }

  function extractVisibleText() {
    if (!document.body) return '';
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: n => {
          const el = n.parentElement;
          if (!el) return NodeFilter.FILTER_REJECT;
          const tag = el.tagName?.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const parts = [];
    let totalLen = 0;
    while (walker.nextNode() && totalLen < 2000) {
      const t = walker.currentNode.textContent?.trim();
      if (t && t.length > 3) {
        parts.push(t);
        totalLen += t.length;
      }
    }
    return parts.join(' ').slice(0, 2000);
  }

  function buildPageData() {
    return {
      title: document.title?.slice(0, 200) || '',
      metaDescription: document.querySelector('meta[name="description"]')?.content?.slice(0, 300) || '',
      forms: extractForms(),
      externalScripts: extractExternalScripts(),
      ssl: extractSSLInfo(),
      domainAgeDays: null,
      redirects: [],
      domain: window.location.hostname,
      colorScheme: getComputedStyle(document.documentElement).getPropertyValue('--primary-color') || '',
      visibleText: extractVisibleText()
    };
  }

  async function runAnalysis() {
    const url = window.location.href;
    const domain = window.location.hostname;
    if (!domain || domain === 'newtab' || url.startsWith('chrome://')) return;

    const pageData = buildPageData();
    chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE', payload: { url, domain, pageData } });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SHOW_WARNING' && message.payload?.score < 20) {
      showDangerOverlay(message.payload);
    }
    if (message.type === 'REQUEST_PAGE_DATA') {
      chrome.runtime.sendMessage({
        type: 'ANALYZE_PAGE',
        payload: {
          url: window.location.href,
          domain: window.location.hostname,
          pageData: buildPageData()
        }
      });
    }
  });

  function showDangerOverlay(analysis) {
    if (document.getElementById('escudo-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'escudo-overlay';
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; z-index: 2147483647;
      background: #c0392b; color: white; padding: 12px 20px;
      font-family: -apple-system, sans-serif; font-size: 14px;
      display: flex; align-items: center; gap: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    `;
    overlay.innerHTML = `
      <span style="font-size:20px">⚠️</span>
      <div style="flex:1">
        <strong>Escudo Financiero: PELIGRO</strong> — ${analysis.titulo || 'Sitio potencialmente fraudulento'}
        <br><small>${analysis.resumen || ''}</small>
      </div>
      <button id="escudo-close" style="background:rgba(255,255,255,0.2);border:none;color:white;
        padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px">Entendido</button>
    `;
    document.body.prepend(overlay);
    document.getElementById('escudo-close').onclick = () => overlay.remove();
  }

  runAnalysis();
})();
