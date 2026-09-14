module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [["@babel/plugin-proposal-decorators", { version: "legacy" }]],
    // Note: NativeWind v4 needs no Babel plugin — styling is handled
    // by withNativeWind in metro.config.js. Do not re-add nativewind/babel.
  };
};
