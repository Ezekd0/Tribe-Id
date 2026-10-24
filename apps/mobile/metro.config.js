const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
// Web reference and native client intentionally use different React versions.
// Resolve all native dependencies against the native workspace's renderer.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/^(react|react-dom)(\/|$)/.test(moduleName)) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [__dirname] }) };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
