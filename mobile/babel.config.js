// Expo's babel preset — transforms RN/Flow source + the expo-router plugin so
// jest-expo can transform component tests, and `expo start` builds the app.
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
