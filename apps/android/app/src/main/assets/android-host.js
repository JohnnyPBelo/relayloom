/* Bundled Android host adapter. This is not downloaded code and exposes no file/shell/HTTP bridge. */
(() => {
  'use strict';
  const bridge = window.RelayLoomNative;
  const capability = new URLSearchParams(location.hash.slice(1)).get('token') || sessionStorage.getItem('relayloom-token');
  if (!bridge || !capability || location.protocol !== 'http:' || location.hostname !== '127.0.0.1') return;
  let pendingPermission;
  window.__relayloomNativePermissionResult = value => {
    if (!['granted', 'denied', 'default'].includes(value)) return;
    const resolve = pendingPermission; pendingPermission = undefined; resolve?.(value);
  };
  class NativeNotification extends EventTarget {
    static get permission() { return bridge.notificationPermission(capability); }
    static requestPermission() {
      if (pendingPermission) return Promise.resolve('default');
      return new Promise(resolve => { pendingPermission = resolve; bridge.requestNotificationPermission(capability); });
    }
    constructor(_title, _options) {
      super(); this.onclick = null; this.onclose = null; this.onerror = null;
      // Native code accepts no caller-supplied title/body, attachment or identity information.
      if (!bridge.showPrivateNotification(capability)) throw new DOMException('Native notifications are unavailable', 'NotAllowedError');
    }
    close() { bridge.closePrivateNotification(capability); this.onclose?.(new Event('close')); }
  }
  Object.defineProperty(window, 'Notification', { value: NativeNotification, configurable: true });

  // Explicit SAF transitions pause capture before Android backgrounds this WebView.
  const activeTracks = new Set();
  let captureEpoch = 0, captureSuspended = false;
  if (navigator.mediaDevices?.getUserMedia) {
    const originalCapture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (captureSuspended) throw new DOMException('Document handoff in progress', 'AbortError');
      const epoch = captureEpoch, stream = await originalCapture(constraints);
      if (captureSuspended || epoch !== captureEpoch) {
        for (const track of stream.getTracks()) track.stop();
        throw new DOMException('Capture cancelled by document handoff', 'AbortError');
      }
      for (const track of stream.getTracks()) {
        activeTracks.add(track); track.addEventListener('ended', () => activeTracks.delete(track), { once: true });
      }
      return stream;
    };
  }
  window.__relayloomSuspendForDocument = () => {
    captureSuspended = true; captureEpoch++;
    for (const track of activeTracks) { track.stop(); track.dispatchEvent(new Event('ended')); }
    activeTracks.clear();
    for (const media of document.querySelectorAll('audio,video')) media.pause();
  };

  window.__relayloomResumeFromDocument = () => { captureSuspended = false; };

  // Retain only Blob objects created by this page until their normal revocation. Reading
  // these objects directly keeps the server's strict connect-src policy unchanged.
  const localBlobs = new Map(), createBlobURL = URL.createObjectURL.bind(URL), revokeBlobURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = value => { const url = createBlobURL(value); if (value instanceof Blob) localBlobs.set(url, value); return url; };
  URL.revokeObjectURL = value => { localBlobs.delete(String(value)); return revokeBlobURL(value); };

  let exportPending = false;
  const exports = new Set();
  function status(text, error = false) {
    let region = document.getElementById('android-document-status');
    if (!region) {
      region = document.createElement('div'); region.id = 'android-document-status';
      region.style.cssText = 'pointer-events:none;position:fixed;left:16px;right:16px;bottom:18px;z-index:300;padding:14px 16px;border:1px solid var(--line);border-radius:9px;background:var(--surface);color:var(--ink);font:13px/1.6 system-ui;box-shadow:0 8px 28px #0002';
      document.body.appendChild(region);
    }
    region.setAttribute('role', error ? 'alert' : 'status'); region.setAttribute('aria-live', error ? 'assertive' : 'polite'); region.textContent = text;
    clearTimeout(region.__hideTimer); region.__hideTimer = setTimeout(() => region.remove(), 7000);
  }
  function finishExport(text, error = false) {
    exportPending = false; status(text, error);
  }
  window.__relayloomDocumentResult = (id, result, message) => {
    if (!['selected', 'saved', 'cancelled', 'expired', 'error'].includes(result) || typeof message !== 'string') return;
    if (exports.delete(id)) finishExport(message, result === 'expired' || result === 'error');
    else status(message, result === 'expired' || result === 'error');
  };
  async function saveBlob(anchor) {
    if (exportPending) { status('Conclui ou cancela a transferência em curso.'); return; }
    exportPending = true; status('A preparar o documento. Escolhe o destino no selector do Android.');
    try {
      const value = anchor.getAttribute('href');
      if (!value?.startsWith('blob:') || new URL(value.slice(5)).origin !== location.origin) throw new Error('Só é possível guardar um anexo local desta sessão.');
      const blob = localBlobs.get(value); if (!blob) throw new Error('O anexo local já não está disponível.');
      const mime = blob.type.split(';')[0] || 'application/octet-stream';
      const name = anchor.download || 'documento';
      const limit = name.toLowerCase().endsWith('.vault.json') && mime === 'application/json' ? 8192 : 2_000_000;
      if (blob.size > limit) throw new Error('O documento excede o limite permitido.');
      const encoded = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = () => reject(new Error('Não foi possível ler o anexo local.')); reader.readAsDataURL(blob);
      });
      const result = JSON.parse(bridge.exportDocument(capability, name, mime, encoded));
      if (!result.ok) throw new Error(result.error || 'Não foi possível abrir o destino do documento.');
      exports.add(result.id);
    } catch (error) { finishExport(error instanceof Error ? error.message : 'Não foi possível guardar o documento.', true); }
  }
  const browserClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    // Recovery export creates a detached download anchor, so it never reaches document listeners.
    if (this.hasAttribute('download') && this.getAttribute('href')?.startsWith('blob:')) { void saveBlob(this); return; }
    return browserClick.call(this);
  };
  document.addEventListener('click', event => {
    const anchor = event.target instanceof Element ? event.target.closest('a[download]') : null;
    if (!anchor || !anchor.getAttribute('href')?.startsWith('blob:')) return;
    event.preventDefault(); event.stopPropagation(); void saveBlob(anchor);
  }, true);
})();
