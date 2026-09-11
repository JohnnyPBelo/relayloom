const { resolve } = require("node:path");
const repository = resolve(__dirname, "../..");
module.exports = {
  appId: "org.relayloom.desktop",
  productName: "RelayLoom",
  electronVersion: require("electron/package.json").version,
  artifactName: "RelayLoom-${version}-${os}-${arch}.${ext}",
  directories: {
    app: resolve(repository, "dist/desktop/app"),
    output: resolve(repository, "dist/desktop-installers"),
  },
  files: ["main.cjs", "package.json", "LICENSE"],
  extraResources: [
    { from: resolve(repository, "dist/desktop/daemon"), to: "daemon" },
  ],
  asar: true,
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  npmRebuild: false,
  electronLanguages: ["en-US", "pt-PT"],
  linux: {
    target: ["AppImage"],
    category: "Network;InstantMessaging",
    synopsis: "Experimental encrypted peer-to-peer communication",
    executableName: "relayloom",
  },
  win: { target: ["nsis"] },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
  mac: {
    target: ["dmg"],
    category: "public.app-category.social-networking",
    hardenedRuntime: true,
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Record a voice message when you choose the microphone button.",
    },
  },
};
