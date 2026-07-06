// Metro config. The app writes ESM-correct ".js" import specifiers on ".ts"/
// ".tsx" sources (matching tsconfig "Bundler" resolution + jest's
// moduleNameMapper). Metro does NOT remap ".js" -> ".ts"/".tsx" on its own, so a
// relative ".js" specifier with no real ".js" on disk fails to bundle. This
// resolver retries the TS source in that case — the one piece that lets the app
// actually bundle for `expo export` / `expo start` / EAS.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Tests are colocated, including inside app/ (jest.config.js testMatch picks
// them up there). expo-router would otherwise register *.test.tsx as routes
// and crash on their top-level jest.* calls, so keep them out of the bundle.
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : [config.resolver.blockList]),
  /\.test\.(ts|tsx)$/,
].filter(Boolean);

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
