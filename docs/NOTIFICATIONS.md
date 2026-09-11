# Private browser notifications

The opt-in hook and settings component are in `apps/web/src/notifications.tsx`, with isolated styles in `notifications.css`.

```tsx
const notifications = usePrivateMessageNotifications({
  identityId: me?.id ?? null,
  messages: objects,
  locked: !state || state.locked,
});
// Call the hook before any locked/onboarding early return.
// In the settings card:
<NotificationSettings controller={notifications} />
```

The parent supplies verified display objects. The hook does not independently authenticate raw network packets and must not receive unvalidated transport payloads.

## Permission and privacy

Notifications start disabled. Only the explicit **Activar notificações** button may request browser permission. No effect, incoming message, startup, reload, or unlock opens a permission prompt. If the browser already grants permission, that same explicit action enables this identity's preference without requesting again.

The preference is stored under `relayloom-private-notifications:<identityId>` in localStorage. It is scoped to the current identity and browser origin. It survives a reload of that origin; it does not promise persistence across changing localhost ports, browser data removal, or other devices. If storage is unavailable, the UI says activation applies only to the current session. Disabling changes the app preference and closes this hook's notices; it does not modify the browser's permission for unrelated features or sites.

Every notice uses only:

| Field | Value |
| --- | --- |
| Title | `RelayLoom` |
| Body | `Tens novas mensagens privadas. Abre o RelayLoom para as ler.` |
| Tag | `relayloom-private-message` |
| Silent | `true` |

No sender name, message text, conversation title, content/identity identifier, attachment filename, icon URL, or remote resource is placed in the native notification options. Clicking an owned notice may focus the current application window; it does not expose or navigate to a particular conversation.

## New-message and lifecycle rules

- The first snapshot on startup, reload, identity change, or unlock is a baseline. Existing history does not trigger notices.
- Subsequent unseen objects trigger eligibility only when `kind === 'message'`, `public === false`, and the author differs from the active identity. Outgoing messages, public posts, edits, reactions, and other object kinds remain silent.
- The session tracks up to 4096 IDs, retaining the current bounded display snapshot. If an integration supplies more than 4096 objects at once, it re-baselines instead of creating a flood. This is a bounded session deduplicator, not a permanent cross-device notification ledger.
- One generic notification attempt is allowed per ten-second window. Further eligible arrivals coalesce into one pending generic notice. The hook closes its previous owned notice before creating another and uses a stable replacement tag.
- Lock, identity change, disable, and unmount clear pending timers and close owned notices. A generation guard prevents a late permission result or stale notice callback from reactivating a different/locked identity.
- **Cancelar activação** cancels the app's pending opt-in. The browser owns its permission prompt; the hook cannot promise to dismiss that prompt. A later granted result is ignored for the cancelled activation.
- Permission status is refreshed on window focus/visibility changes. Denied and unsupported states are explained honestly. A constructor/delivery error pauses the preference instead of claiming that an OS notice was displayed.
- The settings action remains the same DOM button as it changes between Enable, Cancel and Disable, preserving keyboard focus. State changes use a polite live status region.

## Availability boundary

This implementation observes messages while the application is open and its local node continues to provide state. It creates ordinary browser Notification requests. It does not register a service worker, create a Web Push subscription, add a central push service, or guarantee delivery after the browser/app closes. Background throttling, device sleep, OS privacy controls and Do Not Disturb can suppress or delay actual display.

Some mobile/browser environments expose partial Notification APIs but require a service worker or reject construction; those errors leave notifications inactive with an explanation. Native OS toast display, sound, desktop-wrapper permission integration, closed-app/background delivery, and physical mobile-device behavior remain unverified here.

## Synthetic integration tests

```sh
node scripts/e2e.mjs tests/e2e/notifications.spec.ts --reporter=line --output=.cache/notifications-e2e
node_modules/.bin/tsc --noEmit --pretty false
```

The three tests replace both the Notification constructor and permission request with controlled page-local stubs. They never call the native permission API, display a real OS toast, grant actual notification permissions, or alter a real user's notification settings. The browser sandbox remains enabled.

Two real local peer nodes exchange private messages and a public post through the application's normal APIs. Stub observations verify explicit opt-in, history/outgoing/public suppression, generic content-free options, ten-second burst coalescing, opt-in persistence across reload, and disable/lock cleanup. Other cases cover cancelled asynchronous permission, denied/unavailable APIs and a failed constructor. A controlled display-state response with another valid public identity verifies identity-specific cleanup/preference separation; it does not claim vault replacement or identity migration was exercised.

A scoped axe audit verifies the settings region. A screenshot records the integrated settings UI; it is a settings screenshot, not an OS notification screenshot.

The final integrated run against `index-DC1K4nHj.js` passed **3/3 tests in 38.7 seconds** on 2026-09-11 with no skips and zero scoped axe violations. This includes the assertion that keyboard focus remains on the settings action after activation. The screenshot was visually reviewed, and the repository TypeScript check also passed.

Actual stub artifacts from the passing run:

- `.cache/notifications-e2e/notifications-notification-91a97-ing-privacy-and-persistence/notification-settings-stub.png`
- `.cache/notifications-e2e/notifications-notification-91a97-ing-privacy-and-persistence/notification-stub-evidence.json`
- `.cache/notifications-e2e/notifications-lock-identit-2fcda-and-invalidate-pending-work/notification-lifecycle-stub.json`

The JSON explicitly labels the Notification API as a stub. Constructor calls and passing integration assertions must not be reported as actual OS toast delivery or background/device verification.
