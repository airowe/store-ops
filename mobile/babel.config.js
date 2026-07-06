// Expo's babel preset — transforms RN/Flow source + the expo-router plugin so
// jest-expo can transform component tests, and `expo start` builds the app.
module.exports = function (api) {
  api.cache(true);
  // react-native-reanimated/plugin MUST be last — react-native-graph (Skia)
  // uses reanimated worklets. Harmless to jest (react-native-graph is mocked).
  return { presets: ["babel-preset-expo"], plugins: ["react-native-reanimated/plugin"] };
};
