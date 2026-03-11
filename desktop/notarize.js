const { notarize } = require("@electron/notarize");

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") return;

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${appOutDir}/${appName}.app`;

  console.log(`  • notarizing ${appPath}`);

  await notarize({
    tool: "notarytool",
    appPath,
    keychainProfile: "DayLab",
  });
};
