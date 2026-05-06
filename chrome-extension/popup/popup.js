const CIRCUMFERENCE = 2 * Math.PI * 42;

function setColor(colorClass) {
  const resultEl = document.getElementById('state-result');
  ['color-green', 'color-green-pale', 'color-yellow', 'color-orange', 'color-red'].forEach(c =>
    resultEl.classList.remove(c)
  );
  resultEl.classList.add(`color-${colorClass}`);
}

function animateScore(score) {
  const ring = document.getElementById('ring-progress');
  const numberEl = document.getElementById('score-number');
  const offset = CIRCUMFERENCE - (score / 100) * CIRCUMFERENCE;
  ring.style.strokeDashoffset = offset;
  numberEl.textContent = score;
}

function renderRazones(razones) {
  const list = document.getElementById('razones-list');
  list.innerHTML = '';
  (razones || []).forEach(r => {
    const el = document.createElement('div');
    el.className = 'razon-item';
    el.textContent = r;
    list.appendChild(el);
  });
}

function addRow(container, key, val, cls) {
  const row = document.createElement('div');
  row.className = 'detalle-row';
  row.innerHTML = `
    <span class="detalle-key">${key}</span>
    <span class="detalle-val ${cls || ''}">${val}</span>
  `;
  container.appendChild(row);
}

function renderMcpDetails(mcp) {
  if (!mcp) return;
  const content = document.getElementById('detalles-content');
  content.innerHTML = '';

  const stageNames = {
    etapa_1: 'Listas negras / blancas',
    etapa_2: 'Dominio y DNS',
    etapa_3: 'SII y regulador',
    etapa_4: 'Modelo de negocio',
    etapa_5: 'Canales de denuncia',
  };

  (mcp.breakdown || []).forEach(({ stage, partialScore, toolsRun }) => {
    const row = document.createElement('div');
    row.className = 'detalle-row';
    const cls = partialScore < 0 ? 'bad' : partialScore > 0 ? 'ok' : '';
    const sign = partialScore > 0 ? '+' : '';
    const tools = (toolsRun || []).join(', ') || '—';
    row.innerHTML = `
      <span class="detalle-key">${stageNames[stage] || stage}</span>
      <span class="detalle-val ${cls}">${sign}${partialScore}</span>
      <div class="source-row" style="width:100%;font-size:10px;color:#475569;margin-top:2px">${tools}</div>
    `;
    content.appendChild(row);
  });

  if (typeof mcp.nivel === 'number') {
    const nivelCls = mcp.nivel <= 2 ? 'bad' : mcp.nivel === 3 ? 'warn' : 'ok';
    const labelTxt = mcp.etiqueta ? `${mcp.nivel}/5 — ${mcp.etiqueta}` : `${mcp.nivel}/5`;
    addRow(content, 'Nivel de confianza', labelTxt, nivelCls);
  }

  if (mcp.escala) {
    const escalaTxt = mcp.escala === 'cmf' ? 'CMF (regulada)' : 'No-CMF (general)';
    addRow(content, 'Escala aplicada', escalaTxt, '');
  }

  if (mcp.tipoEntidad) {
    addRow(content, 'Tipo entidad', mcp.tipoEntidad, '');
  }

  const confianzaCls = mcp.confianza >= 70 ? 'ok' : mcp.confianza >= 40 ? 'warn' : 'bad';
  addRow(content, 'Confianza análisis', `${mcp.confianza ?? 0}%`, confianzaCls);

  if (mcp.stoppedAt) {
    addRow(content, 'Corte temprano en', mcp.stoppedAt, 'warn');
  }

  addRow(content, 'Score MCP raw', mcp.totalScore ?? 0, '');
}

function renderRegulationContext(rc) {
  const btn = document.getElementById('btn-regulation');
  const content = document.getElementById('regulation-content');
  if (!rc) { btn.classList.add('hidden'); return; }

  content.innerHTML = '';

  const leyes = rc.regulacion?.leyesAplicables;
  if (leyes?.length) {
    const sec = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'reg-section-title';
    title.textContent = 'Leyes aplicables';
    sec.appendChild(title);
    leyes.forEach(ley => {
      const item = document.createElement('div');
      item.className = 'reg-law-item';
      const linkHtml = ley.url
        ? `<br><a class="reg-law-link" href="${ley.url}" target="_blank" rel="noopener noreferrer">↗ Ver en BCN</a>`
        : '';
      item.innerHTML = `<span class="reg-law-dot">▸</span><div><span>${ley.nombre}</span>${linkHtml}</div>`;
      sec.appendChild(item);
    });
    content.appendChild(sec);
  }

  const canales = rc.canales?.canales;
  if (canales?.length) {
    const sec = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'reg-section-title';
    title.textContent = 'Dónde denunciar';
    sec.appendChild(title);
    canales.slice(0, 4).forEach(canal => {
      const item = document.createElement('div');
      item.className = 'reg-channel-item';
      const btnHtml = canal.urlFormulario
        ? `<a class="reg-channel-btn" href="${canal.urlFormulario}" target="_blank" rel="noopener noreferrer">Ir al formulario ↗</a>`
        : '';
      item.innerHTML = `
        <span class="reg-channel-name">${canal.nombre || canal.organismo || ''}</span>
        <span class="reg-channel-org">${canal.organismo || ''}</span>
        ${btnHtml}
      `;
      sec.appendChild(item);
    });
    content.appendChild(sec);
  }

  const exp = rc.explicacion?.explicacion_ciudadana || rc.explicacion?.summary;
  if (exp) {
    const sec = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'reg-section-title';
    title.textContent = 'En palabras simples';
    sec.appendChild(title);
    const box = document.createElement('div');
    box.className = 'reg-explicacion';
    box.textContent = exp.length > 200 ? exp.slice(0, 200) + '…' : exp;
    sec.appendChild(box);
    content.appendChild(sec);
  }

  const hasContent = leyes?.length || canales?.length || exp;
  if (hasContent) btn.classList.remove('hidden');
  else btn.classList.add('hidden');
}

function showResult(analysis) {
  document.getElementById('state-loading').classList.add('hidden');
  document.getElementById('state-error').classList.add('hidden');
  document.getElementById('state-setup').classList.add('hidden');
  document.getElementById('state-result').classList.remove('hidden');

  setColor(analysis.color || 'yellow');
  animateScore(analysis.score ?? 50);

  document.getElementById('titulo-badge').textContent = analysis.titulo || 'Análisis completado';
  const resumenText = analysis.escalaLabel
    ? `${analysis.escalaLabel}. ${analysis.resumen || ''}`.trim()
    : (analysis.resumen || '');
  document.getElementById('resumen-text').textContent = resumenText;
  document.getElementById('recomendacion-text').textContent = analysis.recomendacion || '';

  renderRazones(analysis.razones);
  renderMcpDetails(analysis.mcp_details || null);
  renderRegulationContext(analysis.regulation_context || null);
}

function showError() {
  document.getElementById('state-loading').classList.add('hidden');
  document.getElementById('state-result').classList.add('hidden');
  document.getElementById('state-setup').classList.add('hidden');
  document.getElementById('state-error').classList.remove('hidden');
}

function showSetup() {
  document.getElementById('state-loading').classList.add('hidden');
  document.getElementById('state-result').classList.add('hidden');
  document.getElementById('state-error').classList.add('hidden');
  document.getElementById('state-manual').classList.add('hidden');
  document.getElementById('state-setup').classList.remove('hidden');
}

function showLoading() {
  document.getElementById('state-loading').classList.remove('hidden');
  document.getElementById('state-result').classList.add('hidden');
  document.getElementById('state-error').classList.add('hidden');
  document.getElementById('state-setup').classList.add('hidden');
}

function showManual() {
  document.getElementById('state-manual').classList.remove('hidden');
  document.getElementById('state-loading').classList.add('hidden');
  document.getElementById('state-result').classList.add('hidden');
  document.getElementById('state-error').classList.add('hidden');
  document.getElementById('state-setup').classList.add('hidden');
}

// Toggle detalles técnicos
document.getElementById('btn-detalles').addEventListener('click', () => {
  const panel = document.getElementById('detalles-panel');
  const btn = document.getElementById('btn-detalles');
  const isHidden = panel.classList.toggle('hidden');
  btn.textContent = isHidden ? 'Ver detalles técnicos ▾' : 'Ocultar detalles ▴';
});

// Toggle marco legal
document.getElementById('btn-regulation').addEventListener('click', () => {
  const panel = document.getElementById('regulation-panel');
  const btn = document.getElementById('btn-regulation');
  const isHidden = panel.classList.toggle('hidden');
  btn.textContent = isHidden ? 'Marco Legal y Derechos ▾' : 'Marco Legal y Derechos ▴';
});

// Botón configurar (estado setup)
document.getElementById('btn-setup')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Botón revisar configuración (estado error)
document.getElementById('btn-retry-setup')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

function isLocalDomain(domain, url) {
  if (!domain) return true;
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return true;
  return false;
}

function startPolling(tabId) {
  showLoading();
  const poll = setInterval(() => {
    chrome.storage.session.get([`current:${tabId}`], r => {
      const a = r[`current:${tabId}`];
      if (a) {
        clearInterval(poll);
        clearTimeout(pollTimeout);
        if (a.needsSetup) showSetup();
        else if (a.score === null) showError();
        else showResult(a);
      }
    });
  }, 500);
  const pollTimeout = setTimeout(() => { clearInterval(poll); showError(); }, 25000);
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) { showError(); return; }

  let domain;
  try { domain = new URL(tab.url).hostname; } catch { showError(); return; }

  if (isLocalDomain(domain, tab.url)) { showError(); return; }

  document.getElementById('domain-label').textContent = domain;

  chrome.storage.session.get([`current:${tab.id}`], result => {
    const analysis = result[`current:${tab.id}`];

    if (!analysis) {
      showManual();
      document.getElementById('btn-analizar').addEventListener('click', () => {
        chrome.tabs.sendMessage(tab.id, { type: 'REQUEST_PAGE_DATA' }, () => {
          if (chrome.runtime.lastError) {
            chrome.runtime.sendMessage({ type: 'ANALYZE_NOW', tabId: tab.id, url: tab.url, domain });
          }
        });
        startPolling(tab.id);
      });
      return;
    }

    if (analysis.needsSetup) showSetup();
    else if (analysis.score === null) showError();
    else showResult(analysis);
  });
}

init();
