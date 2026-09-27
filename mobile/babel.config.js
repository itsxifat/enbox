module.exports = function (api) {
  api.cache(true);
  return {
    // zustand's ESM middleware reads `import.meta.env` (not valid in a classic script bundle).
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
  };
};
