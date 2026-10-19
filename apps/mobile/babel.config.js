const path = require('path')

// Resolve babel-preset-expo the way Expo does internally, so this works even
// when the preset is nested under node_modules/expo (not hoisted) and we don't
// need it as an explicit dependency.
function resolvePresetExpo() {
  try {
    const expoPkg = require.resolve('expo/package.json', { paths: [__dirname] })
    return require.resolve('babel-preset-expo', { paths: [path.dirname(expoPkg)] })
  } catch (e) {
    return 'babel-preset-expo'
  }
}

module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV)

  const plugins = []
  if (process.env.NODE_ENV !== 'production') {
    // Basalt: dev-only compile-time source injection for the phone preview.
    plugins.push(path.join(__dirname, '.basalt', 'babel-plugin-basalt-source.js'))
  }
  // Do not add react-native-reanimated/plugin — babel-preset-expo wires
  // worklets/reanimated automatically when those packages are installed.

  return {
    presets: [resolvePresetExpo()],
    plugins
  }
}
