# Dependency notices

Reference RNS1.5.4 uses the Reticulum License, with additional purpose restrictions. The Linux/Python3.11 hash lock also fixes cryptography50.0.1, cffi2.1.1, pycparser3.0 and pyserial3.5. Notices and provenance: [reticulum](licenses/reticulum/manifest.json). The adapter is not yet embedded in desktop/mobile distributions.

Generated from package-lock.json; exact versions are locked. Electron includes Chromium/Node and their own notices; desktop packages retain runtime dependency licences. Go and x/crypto/x/text carry separate BSD-style notices. RNS is a separately installed, hash-pinned reference dependency; it is not covered by a blanket MIT claim.

Private state/profile ownership and group metadata now link SQLite into the native app. The existing host/iOS backend is `modernc.org/sqlite v1.58.0` (BSD3), with exact libc v1.75.6. Android's protected process rejected that libc's direct Linux x86_64 SYS_LSTAT, so the Android build selects `github.com/mattn/go-sqlite3 v1.14.52` (MIT), compiled against Android Bionic with `sqlite_omit_load_extension`. The C driver refuses connections without that compile option. The optional `relayloom_sqlite_cgo` tag permits host verification of the same driver; it is not an Android-device test. Versions/checksums are pinned in `native/go.mod`/`go.sum`, notices retained in [native-sqlite](licenses/native-sqlite/manifest.json), and the Android package carries the C-driver notice. Platform execution evidence and remaining limitations are tracked in docs/STATUS.md; selecting a backend is not device-test evidence. No protection or permission is disabled. Node uses SQLite supplied by its runtime.

## (MIT OR CC0-1.0)

- type-fest 0.13.1

## (WTFPL OR MIT)

- utf8-byte-length 1.0.5

## 0BSD

- tslib 2.8.1

## Apache-2.0

- @malept/cross-spawn-promise 2.0.0
- @playwright/test 1.63.0
- baseline-browser-mapping 2.11.22
- ejs 3.1.10
- exponential-backoff 3.1.3
- filelist 1.0.6
- jake 10.9.4
- playwright 1.63.0
- playwright-core 1.63.0
- sumchecker 3.0.1
- typescript 5.9.3

## BSD-2-Clause

- @electron-internal/extract-zip 1.0.5
- @electron/osx-sign 1.3.3
- @electron/windows-sign 1.2.2
- dotenv 16.6.1
- dotenv-expand 11.0.7
- http-cache-semantics 4.2.0

## BSD-3-Clause

- asn1js 3.0.10
- bytestreamjs 2.0.1
- duplexer2 0.1.4
- fast-uri 3.1.7
- global-agent 3.0.0
- pkijs 3.4.0
- roarr 2.15.4
- source-map 0.6.1
- source-map-js 1.2.1
- sprintf-js 1.1.3

## BlueOak-1.0.0

- chownr 3.0.0
- isexe 3.1.5
- minimatch 10.2.6
- minipass 7.1.3
- node-gyp/node_modules/isexe 4.0.0
- sax 1.6.1
- tar 7.5.22
- tar/node_modules/yallist 5.0.0

## CC-BY-4.0

- caniuse-lite 1.0.30001810

## ISC

- @electron/asar/node_modules/minimatch 3.1.5
- @electron/get/node_modules/semver 7.8.5
- @electron/universal/node_modules/minimatch 9.0.9
- @isaacs/fs-minipass 4.0.1
- abbrev 4.0.0
- app-builder-lib/node_modules/@electron/get/node_modules/semver 6.3.1
- app-builder-lib/node_modules/semver 7.7.4
- at-least-node 1.0.0
- cliui 8.0.1
- cross-spawn/node_modules/isexe 2.0.0
- cross-spawn/node_modules/which 2.0.2
- dir-compare/node_modules/minimatch 3.1.5
- electron-to-chromium 1.5.427
- filelist/node_modules/minimatch 5.1.9
- fs.realpath 1.0.0
- get-caller-file 2.0.5
- glob 7.2.3
- glob/node_modules/minimatch 3.1.5
- global-agent/node_modules/semver 7.8.5
- graceful-fs 4.2.11
- hosted-git-info 4.1.0
- hosted-git-info/node_modules/lru-cache 6.0.0
- hosted-git-info/node_modules/yallist 4.0.0
- inflight 1.0.6
- inherits 2.0.4
- json-stringify-safe 5.0.1
- lru-cache 5.1.1
- lucide-react 0.468.0
- node-abi/node_modules/semver 7.8.5
- node-api-version/node_modules/semver 7.8.5
- node-gyp/node_modules/semver 7.8.5
- node-gyp/node_modules/which 6.0.1
- nopt 9.0.0
- once 1.4.0
- picocolors 1.1.1
- proc-log 6.1.0
- rimraf 2.6.3
- semver 6.3.1
- signal-exit 3.0.7
- simple-update-notifier/node_modules/semver 7.8.5
- tiny-async-pool/node_modules/semver 5.7.2
- which 5.0.0
- wrappy 1.0.2
- y18n 5.0.8
- yallist 3.1.1
- yargs-parser 21.1.1

## MIT

- @babel/code-frame 7.29.7
- @babel/compat-data 7.29.7
- @babel/core 7.29.7
- @babel/generator 7.29.8
- @babel/helper-compilation-targets 7.29.7
- @babel/helper-globals 7.29.7
- @babel/helper-module-imports 7.29.7
- @babel/helper-module-transforms 7.29.7
- @babel/helper-plugin-utils 7.29.7
- @babel/helper-string-parser 7.29.7
- @babel/helper-validator-identifier 7.29.7
- @babel/helper-validator-option 7.29.7
- @babel/helpers 7.29.7
- @babel/parser 7.29.8
- @babel/plugin-transform-react-jsx-self 7.29.7
- @babel/plugin-transform-react-jsx-source 7.29.7
- @babel/template 7.29.7
- @babel/traverse 7.29.8
- @babel/types 7.29.8
- @electron/asar 3.4.1
- @electron/asar/node_modules/balanced-match 1.0.2
- @electron/asar/node_modules/brace-expansion 1.1.18
- @electron/fuses 1.8.0
- @electron/fuses/node_modules/fs-extra 9.1.0
- @electron/get 5.1.0
- @electron/notarize 2.5.0
- @electron/notarize/node_modules/fs-extra 9.1.0
- @electron/osx-sign/node_modules/isbinaryfile 4.0.10
- @electron/rebuild 4.2.0
- @electron/universal 2.0.3
- @electron/universal/node_modules/balanced-match 1.0.2
- @electron/universal/node_modules/brace-expansion 2.1.4
- @electron/universal/node_modules/fs-extra 11.4.0
- @electron/windows-sign/node_modules/fs-extra 11.4.0
- @esbuild/aix-ppc64 0.28.2
- @esbuild/android-arm 0.28.2
- @esbuild/android-arm64 0.28.2
- @esbuild/android-x64 0.28.2
- @esbuild/darwin-arm64 0.28.2
- @esbuild/darwin-x64 0.28.2
- @esbuild/freebsd-arm64 0.28.2
- @esbuild/freebsd-x64 0.28.2
- @esbuild/linux-arm 0.28.2
- @esbuild/linux-arm64 0.28.2
- @esbuild/linux-ia32 0.28.2
- @esbuild/linux-loong64 0.28.2
- @esbuild/linux-mips64el 0.28.2
- @esbuild/linux-ppc64 0.28.2
- @esbuild/linux-riscv64 0.28.2
- @esbuild/linux-s390x 0.28.2
- @esbuild/linux-x64 0.28.2
- @esbuild/netbsd-arm64 0.28.2
- @esbuild/netbsd-x64 0.28.2
- @esbuild/openbsd-arm64 0.28.2
- @esbuild/openbsd-x64 0.28.2
- @esbuild/openharmony-arm64 0.28.2
- @esbuild/sunos-x64 0.28.2
- @esbuild/win32-arm64 0.28.2
- @esbuild/win32-ia32 0.28.2
- @esbuild/win32-x64 0.28.2
- @jridgewell/gen-mapping 0.3.13
- @jridgewell/remapping 2.3.5
- @jridgewell/resolve-uri 3.1.2
- @jridgewell/sourcemap-codec 1.6.0
- @jridgewell/trace-mapping 0.3.31
- @malept/flatpak-bundler 0.4.0
- @malept/flatpak-bundler/node_modules/fs-extra 9.1.0
- @napi-rs/lzma-linux-x64-gnu 1.5.1
- @noble/hashes 2.4.0
- @peculiar/asn1-schema 2.9.4
- @peculiar/json-schema 1.1.12
- @peculiar/utils 2.0.3
- @peculiar/webcrypto 1.7.1
- @rolldown/pluginutils 1.0.0-rc.3
- @rollup/rollup-android-arm-eabi 4.63.1
- @rollup/rollup-android-arm64 4.63.1
- @rollup/rollup-darwin-arm64 4.63.1
- @rollup/rollup-darwin-x64 4.63.1
- @rollup/rollup-freebsd-arm64 4.63.1
- @rollup/rollup-freebsd-x64 4.63.1
- @rollup/rollup-linux-arm-gnueabihf 4.63.1
- @rollup/rollup-linux-arm-musleabihf 4.63.1
- @rollup/rollup-linux-arm64-gnu 4.63.1
- @rollup/rollup-linux-arm64-musl 4.63.1
- @rollup/rollup-linux-loong64-gnu 4.63.1
- @rollup/rollup-linux-loong64-musl 4.63.1
- @rollup/rollup-linux-ppc64-gnu 4.63.1
- @rollup/rollup-linux-ppc64-musl 4.63.1
- @rollup/rollup-linux-riscv64-gnu 4.63.1
- @rollup/rollup-linux-riscv64-musl 4.63.1
- @rollup/rollup-linux-s390x-gnu 4.63.1
- @rollup/rollup-linux-x64-gnu 4.63.1
- @rollup/rollup-linux-x64-musl 4.63.1
- @rollup/rollup-openbsd-x64 4.63.1
- @rollup/rollup-openharmony-arm64 4.63.1
- @rollup/rollup-win32-arm64-msvc 4.63.1
- @rollup/rollup-win32-ia32-msvc 4.63.1
- @rollup/rollup-win32-x64-gnu 4.63.1
- @rollup/rollup-win32-x64-msvc 4.63.1
- @serialport/binding-mock 10.2.2
- @serialport/bindings-cpp 13.0.0
- @serialport/bindings-cpp/node_modules/@serialport/parser-delimiter 12.0.0
- @serialport/bindings-cpp/node_modules/@serialport/parser-readline 12.0.0
- @serialport/bindings-cpp/node_modules/debug 4.4.0
- @serialport/bindings-interface 1.2.2
- @serialport/parser-byte-length 13.0.0
- @serialport/parser-cctalk 13.0.0
- @serialport/parser-delimiter 13.0.0
- @serialport/parser-inter-byte-timeout 13.0.0
- @serialport/parser-packet-length 13.0.0
- @serialport/parser-readline 13.0.0
- @serialport/parser-ready 13.0.0
- @serialport/parser-regex 13.0.0
- @serialport/parser-slip-encoder 13.0.0
- @serialport/parser-spacepacket 13.0.0
- @serialport/stream 13.0.0
- @serialport/stream/node_modules/debug 4.4.0
- @sindresorhus/is 4.6.0
- @szmarczak/http-timer 4.0.6
- @types/babel__core 7.20.5
- @types/babel__generator 7.27.0
- @types/babel__template 7.4.4
- @types/babel__traverse 7.28.0
- @types/cacheable-request 6.0.3
- @types/debug 4.1.13
- @types/estree 1.0.9
- @types/fs-extra 9.0.13
- @types/http-cache-semantics 4.2.0
- @types/keyv 3.1.4
- @types/ms 2.1.0
- @types/node 22.20.2
- @types/react 19.3.0
- @types/react-dom 19.3.0
- @types/responselike 1.0.3
- @vitejs/plugin-react 5.2.0
- @xmldom/xmldom 0.8.15
- agent-base 7.1.4
- ajv 8.20.0
- ansi-regex 5.0.1
- ansi-styles 4.3.0
- app-builder-lib 26.15.3
- app-builder-lib/node_modules/@electron/get 3.1.0
- app-builder-lib/node_modules/@electron/get/node_modules/fs-extra 8.1.0
- app-builder-lib/node_modules/ci-info 4.3.1
- app-builder-lib/node_modules/env-paths 2.2.1
- app-builder-lib/node_modules/jsonfile 4.0.0
- app-builder-lib/node_modules/universalify 0.1.2
- async 3.2.6
- async-exit-hook 2.0.1
- asynckit 0.4.0
- aws4 1.13.2
- balanced-match 4.0.4
- base64-js 1.5.1
- bluebird 3.7.2
- boolean 3.2.0
- brace-expansion 5.0.9
- browserslist 4.28.9
- buffer-from 1.1.2
- builder-util 26.15.3
- builder-util-runtime 9.7.0
- cacheable-lookup 5.0.4
- cacheable-request 7.0.4
- call-bind-apply-helpers 1.0.2
- chalk 4.1.2
- chromium-pickle-js 0.2.0
- ci-info 4.4.0
- clone-response 1.0.3
- color-convert 2.0.1
- color-name 1.1.4
- combined-stream 1.0.8
- commander 5.1.0
- compare-version 0.1.2
- concat-map 0.0.1
- convert-source-map 2.0.0
- core-util-is 1.0.3
- cross-dirname 0.1.0
- cross-spawn 7.0.6
- csstype 3.2.3
- debug 4.4.3
- decompress-response 6.0.0
- decompress-response/node_modules/mimic-response 3.1.0
- defer-to-connect 2.0.1
- define-data-property 1.1.4
- define-properties 1.2.1
- delayed-stream 1.0.0
- detect-node 2.1.0
- dir-compare 4.2.0
- dir-compare/node_modules/balanced-match 1.0.2
- dir-compare/node_modules/brace-expansion 1.1.18
- dmg-builder 26.15.3
- dunder-proto 1.0.1
- electron 44.3.0
- electron-builder 26.15.3
- electron-builder-squirrel-windows 26.15.3
- electron-publish 26.15.3
- electron-winstaller 5.4.0
- electron-winstaller/node_modules/fs-extra 7.0.1
- electron-winstaller/node_modules/jsonfile 4.0.0
- electron-winstaller/node_modules/universalify 0.1.2
- electron/node_modules/@types/node 24.13.4
- electron/node_modules/undici-types 7.18.2
- emoji-regex 8.0.0
- end-of-stream 1.4.5
- env-paths 3.0.0
- err-code 2.0.3
- es-define-property 1.0.1
- es-errors 1.3.0
- es-object-atoms 1.1.2
- es-set-tostringtag 2.1.0
- es6-error 4.1.1
- esbuild 0.28.2
- escalade 3.2.0
- escape-string-regexp 4.0.0
- fast-deep-equal 3.1.3
- fdir 6.5.0
- filelist/node_modules/balanced-match 1.0.2
- filelist/node_modules/brace-expansion 2.1.4
- form-data 4.0.6
- fs-extra 10.1.0
- fsevents 2.3.3
- function-bind 1.1.2
- gensync 1.0.0-beta.2
- get-intrinsic 1.3.0
- get-proto 1.0.1
- get-stream 5.2.0
- glob/node_modules/balanced-match 1.0.2
- glob/node_modules/brace-expansion 1.1.18
- globalthis 1.0.4
- gopd 1.2.0
- got 11.8.6
- has-flag 4.0.0
- has-property-descriptors 1.0.2
- has-symbols 1.1.0
- has-tostringtag 1.0.2
- hasown 2.0.4
- http-proxy-agent 7.0.2
- http2-wrapper 1.0.3
- https-proxy-agent 7.0.6
- is-fullwidth-code-point 3.0.0
- isarray 1.0.0
- isbinaryfile 5.0.7
- jiti 2.7.0
- js-tokens 4.0.0
- js-yaml 4.3.2
- jsesc 3.1.0
- json-buffer 3.0.1
- json-schema-traverse 1.0.0
- json5 2.2.3
- jsonfile 6.2.1
- keyv 4.5.4
- lazy-val 1.0.5
- lodash 4.18.1
- lowercase-keys 2.0.0
- matcher 3.0.0
- math-intrinsics 1.1.0
- mime 2.6.0
- mime-db 1.52.0
- mime-types 2.1.35
- mimic-response 1.0.1
- minimist 1.2.8
- minizlib 3.1.0
- mkdirp 0.5.6
- ms 2.1.3
- nanoid 3.3.19
- node-abi 4.35.0
- node-addon-api 8.3.0
- node-api-version 0.2.1
- node-gyp 12.4.0
- node-gyp-build 4.8.4
- node-gyp/node_modules/env-paths 2.2.1
- node-gyp/node_modules/undici 6.28.1
- node-int64 0.4.0
- node-releases 2.0.55
- normalize-url 6.1.0
- object-keys 1.1.1
- p-cancelable 2.1.1
- p-limit 3.1.0
- path-is-absolute 1.0.1
- path-key 3.1.1
- pe-library 0.4.1
- picomatch 4.0.7
- pkijs/node_modules/@noble/hashes 1.4.0
- plist 3.1.0
- postcss 8.5.28
- postject 1.0.0-alpha.6
- postject/node_modules/commander 9.5.0
- prettier 3.9.6
- process-nextick-args 2.0.1
- progress 2.0.3
- promise-retry 2.0.1
- proper-lockfile 4.1.2
- pump 3.0.4
- pvtsutils 1.3.6
- pvutils 1.2.0
- quick-lru 5.1.1
- react 19.3.0
- react-dom 19.3.0
- react-refresh 0.18.0
- read-binary-file-arch 1.0.6
- readable-stream 2.3.8
- require-directory 2.1.1
- require-from-string 2.0.2
- resedit 1.7.2
- resolve-alpn 1.2.1
- responselike 2.0.1
- retry 0.12.0
- rollup 4.63.1
- safe-buffer 5.1.2
- scheduler 0.28.0
- semver-compare 1.0.0
- serialize-error 7.0.1
- serialport 13.0.0
- serialport/node_modules/debug 4.4.0
- shebang-command 2.0.0
- shebang-regex 3.0.0
- simple-update-notifier 2.0.0
- source-map-support 0.5.21
- stat-mode 1.0.0
- string-width 4.2.3
- string_decoder 1.1.1
- strip-ansi 6.0.1
- supports-color 7.2.0
- temp 0.9.4
- temp-file 3.4.0
- tiny-async-pool 1.3.0
- tinyglobby 0.2.17
- tmp 0.2.7
- tmp-promise 3.0.3
- tsx 4.23.13
- undici 7.29.1
- undici-types 6.21.0
- universalify 2.0.1
- unzipper 0.12.5
- unzipper/node_modules/fs-extra 11.3.1
- update-browserslist-db 1.3.3
- util-deprecate 1.0.2
- vite 7.3.6
- webcrypto-core 1.9.2
- wrap-ansi 7.0.0
- xmlbuilder 15.1.1
- yargs 17.7.3
- yocto-queue 0.1.0

## MPL-2.0

- @axe-core/playwright 4.13.0
- axe-core 4.13.0

## Python-2.0

- argparse 2.0.1

## WTFPL OR ISC

- sanitize-filename 1.6.4

## WTFPL

- truncate-utf8-bytes 1.0.2
