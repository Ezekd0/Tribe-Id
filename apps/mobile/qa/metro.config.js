const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../../..')];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/^(react|react-dom)(\/|$)/.test(moduleName)) {
    return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [path.resolve(__dirname, '..')] }) };
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
