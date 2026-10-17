const textSizeButton = document.querySelector('.text-size');
let storedSize = null;
try { storedSize = localStorage.getItem('isp-text-large'); } catch (_) {}

function setLargeText(enabled) {
  document.documentElement.style.fontSize = enabled ? '21px' : '18px';
  textSizeButton.setAttribute('aria-pressed', String(enabled));
  textSizeButton.textContent = enabled ? 'A−' : 'A+';
  textSizeButton.setAttribute('aria-label', enabled ? 'Use standard text size' : 'Make text larger');
}

setLargeText(storedSize === 'true');
textSizeButton.addEventListener('click', () => {
  const enabled = textSizeButton.getAttribute('aria-pressed') !== 'true';
  try { localStorage.setItem('isp-text-large', String(enabled)); } catch (_) {}
  setLargeText(enabled);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js'));
}
