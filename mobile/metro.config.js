// Metro config. The app writes ESM-correct ".js" import specifiers on ".ts"/
// ".tsx" sources (matching tsconfig "Bundler" resolution + jest's
// moduleNameMapper). Metro does NOT remap ".js" -> ".ts"/".tsx" on its own, so a
// relative ".js" specifier with no real ".js" on disk fails to bundle. This
// resolver retries the TS source in that case — the one piece that lets the app
// actually bundle for `expo export` / `expo start` / EAS.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if ((moduleName.startsWith("./") || moduleName.startsWith("../")) && moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch {
      // Fall back to the TS source the ".js" specifier actually points at.
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
