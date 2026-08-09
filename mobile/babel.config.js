/**
 * Babel config — exists ONLY to add the worklets plugin.
 *
 * SDK 57 needs no babel.config.js (babel-preset-expo is the default), which is
 * why the SDK 57 upgrade deleted it. But react-native-reanimated 4 moved its
 * worklet transform into `react-native-worklets/plugin`, and without that
 * plugin every worklet fails to compile and the runtime throws the misleading
 * "react-native-reanimated is not installed!" — even though it IS installed and
 * its pod IS linked (RNReanimated appears in Podfile.lock).
 *
 * Reached via @shopify/react-native-skia in src/lib/skiaShotRenderer.ts, so it
 * breaks the capture-kit screen on launch.
 *
 * MUST be last in the plugin list (the plugin's own requirement).
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: ["react-native-worklets/plugin"],
  };
};
