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
    clientInfo: { name: 'escudo-financiero', version: '2.1.0' }
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

// ── Nivel / verdict mapping (compatibilidad MCP nuevo y legacy) ────────────

// Cuando el MCP retorna `nivel` (1-5), se prefiere sobre `verdict` legacy.
// El score 0..100 del popup se deriva del nivel para que el ring del semáforo
// coincida con la etiqueta. El `totalScore` crudo del MCP queda visible en
// detalles técnicos.

const NIVEL_TO_SCORE = { 1: 10, 2: 30, 3: 50, 4: 75, 5: 95 };
const NIVEL_TO_COLOR = {
  1: 'red',
  2: 'orange',
  3: 'yellow',
  4: 'green-pale',
  5: 'green'
};
const NIVEL_TO_TITULO = {
  1: 'Crítico: no entregues datos',
  2: 'Riesgoso: revisa antes de continuar',
  3: 'Neutro: avanza con cautela',
  4: 'Confiable',
  5: 'Muy confiable'
};
const NIVEL_TO_RECOMENDACION = {
  1: 'No entregues datos personales ni realices transacciones en este sitio.',
  2: 'Hay señales negativas significativas. Verifica por canales oficiales antes de operar.',
  3: 'Hay señales menores. Verifica antes de entregar datos o dinero.',
  4: 'Sin señales negativas relevantes. Confirma de todos modos por canales oficiales.',
  5: 'Señales convergentes de legitimidad. Procede con precaución normal.'
};

const VERDICT_TO_NIVEL = {
  alto_riesgo: 2,
  riesgo_medio: 3,
  sin_senales_negativas: 4
};

function resolveNivel(mcp) {
  if (typeof mcp.nivel === 'number' && mcp.nivel >= 1 && mcp.nivel <= 5) return mcp.nivel;
  return VERDICT_TO_NIVEL[mcp.verdict] ?? 3;
}

function normalizeScore(mcp) {
  const nivel = resolveNivel(mcp);
  return NIVEL_TO_SCORE[nivel] ?? 50;
}

function nivelToColor(nivel) {
  return NIVEL_TO_COLOR[nivel] || 'yellow';
}

function nivelToTitulo(mcp, nivel) {
  return mcp.etiqueta || NIVEL_TO_TITULO[nivel] || 'Análisis completado';
}

function escalaLabel(escala) {
  if (escala === 'cmf') return 'Empresa que debería estar regulada por la CMF';
  if (escala === 'no_cmf') return 'Empresa fuera del perímetro CMF';
  return null;
}

function buildResumen(mcp) {
  const topReasons = (mcp.reasons || [])
    .filter(r => r.kind !== 'info')
    .slice(0, 2)
    .map(r => r.message)
    .filter(Boolean);
  if (topReasons.length) return topReasons.join('. ') + '.';
  return `Análisis completado con ${mcp.confianza ?? 0}% de confianza.`;
}

function buildRecomendacion(nivel) {
  return NIVEL_TO_RECOMENDACION[nivel] || 'Procede con precaución normal.';
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

    const nivel = resolveNivel(mcp);
    const score = normalizeScore(mcp);
    const color = nivelToColor(nivel);

    const analysis = {
      score,
      color,
      titulo: nivelToTitulo(mcp, nivel),
      escalaLabel: escalaLabel(mcp.escala),
      resumen: buildResumen(mcp),
      razones: (mcp.reasons || [])
        .filter(r => r.kind !== 'info')
        .map(r => r.message)
        .filter(Boolean),
      recomendacion: buildRecomendacion(nivel),
      mcp_details: {
        verdict: mcp.verdict,
        nivel,
        etiqueta: mcp.etiqueta ?? NIVEL_TO_TITULO[nivel] ?? null,
        escala: mcp.escala ?? null,
        requiereCMF: mcp.requiereCMF ?? null,
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

    if (nivel === 1) {
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
