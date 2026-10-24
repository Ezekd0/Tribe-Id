const {getDefaultConfig}=require('expo/metro-config');const path=require('node:path');
const config=getDefaultConfig(__dirname);config.watchFolders=[path.resolve(__dirname,'../../../..')];
config.resolver.resolveRequest=(context,moduleName,platform)=>/^(react|react-dom)(\/|$)/.test(moduleName)?{type:'sourceFile',filePath:require.resolve(moduleName,{paths:[path.resolve(__dirname,'../..')]})}:context.resolveRequest(context,moduleName,platform);
module.exports=config;
