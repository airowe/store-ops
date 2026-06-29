// Single test runner: jest-expo transforms RN/TSX via babel-preset-expo so both
// pure-logic tests (*.test.ts) and component render tests (*.test.tsx) run here.
module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/src/**/*.test.tsx", "<rootDir>/app/**/*.test.tsx"],
  moduleNameMapper: {
    // Source uses ESM-correct ".js" import specifiers on ".ts" files (for tsc's
    // Bundler resolution); map them back so jest's resolver finds the TS source.
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@tanstack/.*))",
  ],
};
