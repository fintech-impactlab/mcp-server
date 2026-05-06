const DEFAULT_URL = 'https://ca-mcp-fintech-dev.ambitiousstone-a9e5f771.eastus.azurecontainerapps.io/mcp';

const urlInput = document.getElementById('mcp-url');
const keyInput = document.getElementById('mcp-key');
const statusEl = document.getElementById('status');

// Pre-fill saved values on load
chrome.storage.local.get(['mcpUrl', 'mcpApiKey'], ({ mcpUrl, mcpApiKey }) => {
  urlInput.value = mcpUrl || DEFAULT_URL;
  keyInput.value = mcpApiKey || '';
});

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'error' : '';
  setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

document.getElementById('save').addEventListener('click', () => {
  const url = urlInput.value.trim();
  const key = keyInput.value.trim();

  if (!url) { showStatus('La URL no puede estar vacía.', true); return; }
  if (!key) { showStatus('La API key no puede estar vacía.', true); return; }

  try { new URL(url); } catch {
    showStatus('URL inválida. Debe comenzar con http:// o https://', true);
    return;
  }

  chrome.storage.local.set({ mcpUrl: url, mcpApiKey: key }, () => {
    showStatus('Configuración guardada ✓');
  });
});

// Allow saving with Enter key
keyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('save').click();
});
