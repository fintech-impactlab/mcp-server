const CACHE_TTL_MS = 60 * 60 * 1000;
const memCache = new Map();

// ── Config (chrome.storage.local) ──────────────────────────────────────────

async function getConfig() {
  return new Promise(resolve => {
    chrome.storage.local.get(['mcpUrl', 'mcpApiKey'], ({ mcpUrl, mcpApiKey }) => {
      resolve({ url: mcpUrl || '', key: mcpApiKey || '' });
    });
  });
}

// ── MCP JSON-RPC 2.0 client ────────────────────────────────────────────────

let sessionId = null;
let reqId = 0;

async function mcpPost(method, params) {
  const { url, key } = await getConfig();
  if (!url || !key) throw new Error('MCP_NOT_CONFIGURED');

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${key}`,
    ...(sessionId ? { 'mcp-session-id': sessionId } : {})
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: ++reqId })
  });

  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);

  const newSession = res.headers.get('mcp-session-id');
  if (newSession) sessionId = newSession;

  // El servidor responde SSE (text/event-stream): extraer línea "data: {...}"
  const text = await res.text();
  let data;
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      data = JSON.parse(line.slice(6));
      break;
    }
  }
  if (!data) throw new Error('MCP: respuesta SSE vacía');
  if (data.error) throw new Error(data.error.message || 'MCP error');
  return data.result;
}

async function initSession() {
  sessionId = null;
  await mcpPost('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'escudo-financiero', version: '2.0.0' }
  });
}

async function callTool(name, args) {
  if (!sessionId) await initSession();
  const result = await mcpPost('tools/call', { name, arguments: args });
  // MCP tool results come as content[0].text (JSON string)
  return JSON.parse(result.content[0].text);
}

// ── Cache ──────────────────────────────────────────────────────────────────

function getCacheKey(domain) {
  return `escudo:${domain}`;
}

async function getFromCache(domain) {
  const key = getCacheKey(domain);
  const mem = memCache.get(key);
  if (mem && Date.now() - mem.ts < CACHE_TTL_MS) return mem.data;

  return new Promise(resolve => {
    chrome.storage.local.get([key], result => {
      const entry = result[key];
      if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
        memCache.set(key, entry);
        resolve(entry.data);
      } else {
        resolve(null);
      }
    });
  });
}

async function saveToCache(domain, data) {
  const key = getCacheKey(domain);
  const entry = { data, ts: Date.now() };
  memCache.set(key, entry);
  chrome.storage.local.set({ [key]: entry });
}

// ── Badge ──────────────────────────────────────────────────────────────────

function updateBadge(tabId, analysis) {
  const colorMap = {
    'green':      [34, 197, 94, 255],
    'green-pale': [134, 239, 172, 255],
    'yellow':     [234, 179, 8, 255],
    'orange':     [249, 115, 22, 255],
    'red':        [239, 68, 68, 255]
  };
  const textMap = {
    'green': '✓', 'green-pale': '~', 'yellow': '!', 'orange': '!!', 'red': '✕'
  };
  const color = analysis.color || 'yellow';
  chrome.action.setBadgeText({ tabId, text: textMap[color] || '?' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: colorMap[color] || [128, 128, 128, 255] });
  chrome.action.setTitle({ tabId, title: `Escudo Financiero — Score: ${analysis.score}/100` });
}

// ── Score/verdict mapping ──────────────────────────────────────────────────

function normalizeScore(totalScore) {
  // MCP totalScore: roughly -100..+100 → popup 0..100
  return Math.round(Math.max(0, Math.min(100, (totalScore + 100) / 2)));
}

function scoreToColor(score) {
  if (score >= 75) return 'green';
  if (score >= 55) return 'green-pale';
  if (score >= 40) return 'yellow';
  if (score >= 25) return 'orange';
  return 'red';
}

function verdictToTitulo(verdict) {
  const map = {
    alto_riesgo: 'Alto riesgo detectado',
    riesgo_medio: 'Señales de alerta',
    sin_senales_negativas: 'Sin señales negativas'
  };
  return map[verdict] || 'Análisis completado';
}

function buildResumen(mcp) {
  const topReasons = (mcp.reasons || []).slice(0, 2).map(r => r.message).filter(Boolean);
  if (topReasons.length) return topReasons.join('. ') + '.';
  return `Análisis completado con ${mcp.confianza ?? 0}% de confianza.`;
}

function buildRecomendacion(verdict) {
  if (verdict === 'alto_riesgo') return 'No entregues datos personales ni realices transacciones en este sitio.';
  if (verdict === 'riesgo_medio') return 'Verifica la identidad de la empresa antes de continuar.';
  return 'Procede con precaución normal.';
}

// ── Main analysis ──────────────────────────────────────────────────────────

async function analyzeURL(tabId, url, domain, pageData) {
  const cached = await getFromCache(domain);
  if (cached) {
    updateBadge(tabId, cached);
    chrome.storage.session.set({ [`current:${tabId}`]: { ...cached, cached: true } });
    return;
  }

  chrome.action.setBadgeText({ tabId, text: '…' });
  chrome.action.setBadgeBackgroundColor({ tabId, color: [156, 163, 175, 255] });

  try {
    // Detect situacion from DOM signals
    const hasCredentialForms = (pageData.forms || []).some(
      f => f.hasPasswordField || f.hasRUTField
    );
    const situacion = hasCredentialForms ? 'transaccion_no_reconocida' : 'otro';

    // Build text for business model analysis
    const textParts = [pageData.title, pageData.metaDescription, pageData.visibleText]
      .filter(Boolean);
    const text = textParts.join(' ').slice(0, 3000);

    const mcp = await callTool('full_evaluation', {
      input: url,
      ...(text ? { text } : {}),
      situacion
    });

    const score = normalizeScore(mcp.totalScore ?? 0);
    const color = scoreToColor(score);

    const analysis = {
      score,
      color,
      titulo: verdictToTitulo(mcp.verdict),
      resumen: buildResumen(mcp),
      razones: (mcp.reasons || []).map(r => r.message).filter(Boolean),
      recomendacion: buildRecomendacion(mcp.verdict),
      mcp_details: {
        verdict: mcp.verdict,
        confianza: mcp.confianza ?? 0,
        totalScore: mcp.totalScore ?? 0,
        stoppedAt: mcp.stoppedAt ?? null,
        tipoEntidad: mcp.tipoEntidad ?? null,
        breakdown: mcp.breakdown ?? [],
      },
      regulation_context: {
        canales: { canales: mcp.recomendaciones ?? [] }
      }
    };

    updateBadge(tabId, analysis);
    await saveToCache(domain, analysis);
    chrome.storage.session.set({ [`current:${tabId}`]: analysis });

    if (score < 20) {
      chrome.tabs.sendMessage(tabId, { type: 'SHOW_WARNING', payload: analysis }).catch(() => {});
    }

  } catch (err) {
    console.error('[escudo] Error al analizar:', err.message);

    if (err.message === 'MCP_NOT_CONFIGURED') {
      chrome.action.setBadgeText({ tabId, text: '⚙' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: [99, 102, 241, 255] });
      chrome.storage.session.set({ [`current:${tabId}`]: { needsSetup: true } });
      return;
    }

    chrome.action.setBadgeText({ tabId, text: '?' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: [107, 114, 128, 255] });
    chrome.storage.session.set({
      [`current:${tabId}`]: {
        score: null,
        color: 'gray',
        titulo: 'MCP no disponible',
        resumen: 'No se pudo contactar el servidor de análisis.',
        razones: [],
        recomendacion: 'Verifica la configuración en Opciones de la extensión.'
      }
    });
  }
}

// ── Message listeners ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'ANALYZE_PAGE' && sender.tab?.id) {
    const { url, domain, pageData } = message.payload;
    analyzeURL(sender.tab.id, url, domain, pageData);
  }
  if (message.type === 'ANALYZE_NOW') {
    const { tabId, url, domain } = message;
    analyzeURL(tabId, url, domain, {
      title: domain, forms: [], externalScripts: [],
      ssl: { valid: url.startsWith('https') }, domainAgeDays: null, redirects: [],
      visibleText: ''
    });
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, tab => {
    if (tab?.url) {
      chrome.storage.session.get([`current:${tabId}`], result => {
        const analysis = result[`current:${tabId}`];
        if (analysis && !analysis.needsSetup) updateBadge(tabId, analysis);
        else chrome.action.setBadgeText({ tabId, text: '' });
      });
    }
  });
});
