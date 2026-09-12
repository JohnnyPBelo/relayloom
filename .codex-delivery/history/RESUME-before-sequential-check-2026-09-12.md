# Authoritative resumption checkpoint

Project only: /home/absint0o/projects/relayloom. Owner acceptance contract PROJECT-BRIEF.md remains intact. Never touch Contab/other workspaces, providers/auth/bridge/security; owner repaired bridge externally. Maintain15GiBfree, project caches, atmostone Android/native compile and one modest JS build, no purchases/root. Replies PT-PT.

## Completed milestones

- Public main85793be: actual Node22 encrypted messenger/social/sitebuilder with TCP/serialPTY, signed author/read/seed separation, storagequota/TTL, multiprocess positive/negative controls, real UIE2E, simulationdistinct. Follow-up CI fixes4c9e1af,4a15363,a8ae32b,919beec. Latest completed observed CI919beec succeeded Linux+Windows+macOS (native Node on runners, WindowsPTYskips). Evidence docs/evidence/ci-919beec.json.
- Later uncommitted Node/UI/desktop extensions: voice/media, named encryptedcollections+followfilter/hashretrieve, explicitgenericnotifications, largeText/highcontrast. Root verify passed60 tests+8E2E plus simulation; rerunning current tree before nextcommit.
- Electron44.3.0, esbuild0.28.2, builder26.15.3, fuses1.8.0 installed scoped. LinuxX11 sandboxed dev+packaged smoke passed. Dist/desktop-installers/linux-unpacked/relayloom. Nativewindowdialog/hardwarepermissions not verified. Appremote navigationblocked, downloadedblobusesnativedialog, noNodeinrenderer. Native docs/evidence tracked separately.
- NativeGo port currentcore10tests+1bidirectionalNodeInterop1500floatvectors, transport9racetests, app7tests+race, fullbrowserflowsagainstGoCLIpassed19.3s, mixedGo→Node→Go andGo→Node→Nodeserial2tests passed14.96s. These are Linuxhost results, notmobile. CLI .cache/native-app/relayloom, build node scripts/native-build.mjs. JS tests/native explicitlyseparate fromnpmtest. Native scripts/go.mjsusesprojectpatchedGo1.26.8 and GOTOOLCHAINlocal/cachepaths. OfficialGoarchiveSHAverified. x/crypto0.57.0,x/text0.42.0,x/mobile20260908204917-8b95e45f8d3e pinned.

## Active ownership (revalidate collaboration statuses)

- /root/design_review: apps/android/**, scripts/android*, docs/ANDROID.md, .cache/android+JDK. Actual TemurinJDK17.0.20.1, AndroidSDK36/buildtools36/NDK28.2 installed(~3.5GiB). Noemulatorimageyet. gomobile/gobind nowavailable.cache/go/bin. Native.Start(dataDir,assetsPath)JSON{origin,token,tcpPort}, Stop. Agent had408timeouttwice; resumed fromexistingfiles. Fix process-global ownershiplease lifecycle race, then AAR/APK, onlythenoneAPI36x86_64emulator image. Doesnotalterbridge.
- /root/transport_hardening: now native/transport/** correction duplicate retained byte accounting +regression. Must coordinatecompile slotwithAndroid. EarlierNodepollerbugfixcommitted919beec; noNodechangesneeded. RepeatGoCLIbuild/mixedtestsafterfix.
- /root/security_review: read-only independentreviewAndroid+transportfixes, self-reviewnative/coreclearlylabelled; onlydocs/NATIVE-REVIEW.md. Authorednative/core/app, cannotclaimindependentreviewofowncode.
- Root: integration, sharedpackage/go.mod/statusdocs, UI/API/tests, commits/push. Do notformat/editagentownedWIPuntilcomplete.

## Critical open facts

- Go native serial returns501; UI nowlabelsunsupported using nativeRuntimeGo. Android must run embeddedAARcore, neverhostdaemon-onlyWebView.
- Native transportduplicateIDaccounting bug reviewfound: retain[id] replacementaddsbyteswithoutsubtractingold whenseenforgets. Agentfixpending; do notmarknativecompleteuntiltest/rerun.
- Android Activityinstancestop race: globalsingletoncore+perActivityexecutor; ownershiplease/processcoordinatorfixpending. NoAPK/emulatorclaimyet.
- Native andAndroid sources largelyuntracked; keep separatecoherentverifiedmilestonecommits. FullpublicrepositorycanincludeWIP onlyexplicitbranchifneeded; noforcepush/secrets/PRmerge.
- Node/media/e2e fixtures use synthetic identities. Voiceinput controlledWebAudio/getUserMediastub afternativefakeinputNotSupportedError; encoding+transferreal. NotificationAPIstubonly; noOSnotificationclaim. Preserve labels.
- Originalcontractremaining: mobilehardware/Apple signing/platformapps, keychain+rotation/revocation, groupmembershipchanges, completeoutboxdelivery/expiryUI, richerprofiletemplates/socialcontrols, allaccessibilitystates/screenreaderphysical, completeaudit. Never shrinkgoaltoverticalslice.

## Gate commands

npm run verify (build,60+unit/integration,8+browser,simevidence)
node scripts/desktop-build.mjs; node scripts/desktop-run.mjs --smoke --x11
node scripts/desktop-package.mjs --linux --x64 --dir; node scripts/desktop-packaged-smoke.mjs
node scripts/go.mjs test -race -p=2 ./core ./transport ./app
node scripts/native-build.mjs
node --import tsx --test tests/native/native-interop.test.ts
node --import tsx --test --test-concurrency=1 tests/native/mixed-network.test.ts
RELAYLOOM_TEST_BACKEND=native node scripts/e2e.mjs tests/e2e/flows.spec.ts --reporter=line --output=.cache/native-ui-e2e

Toolprocesshandles revalidate rather thanrestart. Duringcheckpointrootstartednpmverify; pollactualsession. In-appbrowserbackendwasunavailable; projectPlaywrightChromiumwithsandboxenabledworks. CIusesrunnerChrome sandboxretained. Allbrowsertemps .cache/tmp. No unrelatedfilesreadexceptstandardtool/runtimepaths.

## Current pagination/review integration (newer than paragraphs above)

The independent application review found A1 request-map error-path growth, A2 large snapshots, A3 old state restoring UI after lock, and A4 received tombstone loss before cache eviction. Root implements Node/UI changes and transport_hardening now exclusively owns native/app fixes plus mixed test updates. Agreed API: state/history pages of100 objects/4MiB, summaries with attachment data empty + size; POST history{before} returns chronological older page and history{hasMore,nextBefore,total,availableIds}; POST attachment{id,index} verifies ACL and returns full Attachment, denies deleted; view returns full object. UI has explicit older-history control, lazy3-concurrent attachment loading, generation/sequence lock protection and nonoverlapping polling. Tests are being rerun; earlier61/8 passes do not cover unfinished current pagination integration.

Root Node snapshot tests passed three cases (large cache>24MiB, remote tombstone evicting original, failed-broadcast request limits); fourth unknown-extension projection test added. UI history/lock tests found and fixed duplicate history controls and returning-to-chat scroll/lazy-load issue; current targeted run is pending, read its process handle rather than assume pass.

Android preliminary AAR/APK built/signature/alignment verified, one API36x86_64 AVD provisioned under project with adb server5047 and ports5580/5581; actual boot became operational after recovering only empty test userdata and explicit ports. No physical mic/camera. Agent must report actual install/UI/network before emulator pass. Native app pagination fixes require another final AAR/APK rebind. Current Android source includes global ownership leases and narrow audio permission guards.

security_review now owns apps/ios/**, scripts/ios*, docs/IOS.md: actual Swift/WKWebView wrapper/Xcodeproject prepared, locally only syntax/staticchecks. Root must add macOS CI job and observe actual xcodebuild; no Apple result exists yet. transport_hardening independently reviewed and corrected stale microphone completion. No Apple signing/device claims.

Latest root native core: strict schema aligned Node envelope validation, Go disk fingerprint uses bounded actual bytes, password lone-surrogate conversion aligns Node, parser100knode budget. Go11core+11transport+7app race and three vector/mixed tests passed before pagination app changes. Rebuild CLI/AAR and rerun after new app changes.


## Checkpoint sequencial — prioridade mais recente, 2026-09-12

O proprietário impôs temporariamente NÃO criar/retomar subagentes; deixar os já activos acabar; integrar e executar UM teste delimitado, sem repetir408 em ciclo e sem qualquer mudança ao harness. Ver SEQUENTIAL-CHECK.md. A instrução supersede a delegação proactiva para esta fase. Goal completo continua activo.

HEAD/origin ainda c3f5b42, CI8jobsverde(inclbuildApple); há outbox Node/Go/UI e SAF Android +runner iOS posteriores ainda sem commit. Node79, Goapp36norm/race, core11+transport11race, mixed2/2 comsourcehash66a18d…30e eCLI4e18b8…422d;14UI cadaNode/Go +target4/4 apósfeedbackmodal. Estes gates acabaram antes/foram iniciados antes do pedido sequencial; não disparar novosgatesbroad agora.

Android actualúltimoAPK4de67c3e passou80 asserções masagente estava a corrigir prazoapóswake e limpeza de16 endpointsdepeerssintéticos, semmudarGo. ÚltimoUIrootestáveldist assetsindex-Ct0M5tYK.js/index-BcajBo5I.css; interfacefeedbackretryagoradentroDialog. Agente precisaentregarestadofinalhonesto, não retomar408. iOSXCUITest+runner foram entregues/revistos/11hostchecks; workflowintegradoaguardapushfuturo. security_review finalizaGROUP-EPOCHS/fixturesdeclarativas,sódesenho.
