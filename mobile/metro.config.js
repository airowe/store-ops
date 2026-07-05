// Source uses ESM-correct ".js" import specifiers on ".ts(x)" files (for tsc's
// Bundler resolution); jest maps them back in jest.config.js moduleNameMapper.
// Metro resolves specifiers literally, so mirror that mapping here.
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

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  if (/^\.\.?\//.test(moduleName) && moduleName.endsWith(".js")) {
    try {
      return resolve(context, moduleName.slice(0, -3), platform);
    } catch {
      // No .ts/.tsx source behind the specifier — fall through to the literal
      // path so real .js files still resolve.
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
