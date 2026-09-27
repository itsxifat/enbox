/**
 * Metro config: the monorepo's `@enbox/shared` contracts package,
 * compiled straight from its TypeScript sources (`packages/shared/src`) so the app and the
 * server always agree on models, limits and helpers.
 */
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedRoot = path.resolve(projectRoot, '../packages/shared');
const sharedEntry = path.join(sharedRoot, 'src/index.ts');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), sharedRoot];
// Native build output (Gradle/CMake churn) is never part of the JS bundle.
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  /[/\\]mobile[/\\]android[/\\].*/,
  /[/\\]mobile[/\\]ios[/\\].*/,
];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (moduleName === '@enbox/shared') return { type: 'sourceFile', filePath: sharedEntry };
  if (context.originModulePath.startsWith(sharedRoot)) {
    // The shared package uses NodeNext-style `./x.js` specifiers for its `.ts` files.
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      return resolve(context, moduleName.replace(/\.js$/, '.ts'), platform);
    }
    // Bare imports (zod) resolve from the app's node_modules.
    if (!moduleName.startsWith('.') && !moduleName.startsWith('/')) {
      return resolve(
        { ...context, originModulePath: path.join(projectRoot, 'package.json') },
        moduleName,
        platform,
      );
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
