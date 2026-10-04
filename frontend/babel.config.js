module.exports = function (api) {
  api.cache(true);
  return {
    // nativewind/babel is a *preset* (it returns { plugins: [...] }), so it
    // belongs here — in `plugins` it fails with
    // ".plugins is not a valid Plugin property".
    // It rewrites React.createElement -> createInteropElement, which is what
    // makes `className` work at all; removing it renders the app unstyled.
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins: [["@babel/plugin-proposal-decorators", { version: "legacy" }]],
  };
};
