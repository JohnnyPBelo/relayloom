# Native minimum-window onboarding review

Root inspected the actual Linux desktop capture for3d6641a and found horizontal clipping at720×600. A new real-browser regression reproduced a772px document in a720px viewport. The earlier desktop smoke verified runtime/security controls but did not check responsive layout.

The welcome grid now permits its two columns to shrink below their intrinsic content width, constrains its decorative weave to its column and scales the intermediate-width heading. The existing mobile single-column layout is preserved. The resulting test checks720,681,800,900,901,1150,1440 and390px, the form's left/right bounds and keyboard movement from name to password.

The next test exposed dark recovery-summary contrast2.08 against the dark form. That disclosure now uses the dark accent text colour. Both light/dark Axe runs then reported zero violations at720px. This is automated accessibility evidence plus root's image review, not a physical screen-reader test or independent audit.

Final assets: `index-CFZzmFWN.js` and `index-DwCp7KCv.css`. After the correction, all15 browser cases passed on Node in116.285s and Go in107.333s. The native desktop build/smoke/package/packaged-smoke commands also passed in0.217s/0.718s/47.550s/2.124s, with frozen recorded inputs. The native smoke now reports actual viewport/document widths and fails on horizontal overflow: observed720/705px, reflecting the vertical scrollbar. API401/200, reachable external-request controls1/1/0, renderer isolation, executable fuses and daemon cleanup remained effective.

Command outcomes, source/input hashes, package/asset hashes and native image are in `docs/evidence/desktop/layout-expiry-fix`; browser measurements, both themes and Axe reports are in `docs/evidence/ui/onboarding-layout-node` and `onboarding-layout-go`. Root inspected the corrected native image and dark browser capture. Native screenshot height reflects the600px window; vertical scrolling is intentional and does not constitute clipped horizontal controls.

The final targeted Node test completed during a tool-session interruption. The original process handle was subsequently unavailable; terminal Playwright status, final result JSON and screenshots confirmed completion, and the suite was not blindly restarted. The later full15+15 validation above has its own exact command records. No provider, bridge, permission or model configuration was changed.
