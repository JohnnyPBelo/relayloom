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
})();
