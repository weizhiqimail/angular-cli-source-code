/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {
  BuildOptimizerWebpackPlugin,
  buildOptimizerLoaderPath,
} from '@angular-devkit/build-optimizer';
import * as CopyWebpackPlugin from 'copy-webpack-plugin';
import { existsSync } from 'fs';
import * as path from 'path';
import { RollupOptions } from 'rollup';
import { ScriptTarget } from 'typescript';
import {
  Compiler,
  Configuration,
  ContextReplacementPlugin,
  RuleSetLoader,
  RuleSetRule,
  compilation,
  debug,
} from 'webpack';
import { RawSource } from 'webpack-sources';
import { AssetPatternClass } from '../../browser/schema';
import { BuildBrowserFeatures, maxWorkers } from '../../utils';
import { WebpackConfigOptions } from '../../utils/build-options';
import { findCachePath } from '../../utils/cache-path';
import {
  allowMangle,
  allowMinify,
  cachingDisabled,
  profilingEnabled,
  shouldBeautify,
} from '../../utils/environment-options';
import { findAllNodeModules } from '../../utils/find-up';
import { Spinner } from '../../utils/spinner';
import { isWebpackFiveOrHigher, withWebpackFourOrFive } from '../../utils/webpack-version';
import {
  BundleBudgetPlugin,
  DedupeModuleResolvePlugin,
  NamedLazyChunksPlugin,
  OptimizeCssWebpackPlugin,
  ScriptsWebpackPlugin,
  WebpackRollupLoader,
} from '../plugins';
import { getEsVersionForFileName, getOutputHashFormat, getWatchOptions, normalizeExtraEntryPoints } from '../utils/helpers';
import { IGNORE_WARNINGS } from '../utils/stats';

const TerserPlugin = require('terser-webpack-plugin');
const PnpWebpackPlugin = require('pnp-webpack-plugin');

// tslint:disable-next-line:no-big-function
export function getCommonConfig(wco: WebpackConfigOptions): Configuration {
  const { root, projectRoot, buildOptions, tsConfig } = wco;
  const {
    platform = 'browser',
    sourceMap: {
      styles: stylesSourceMap,
      scripts: scriptsSourceMap,
      vendor: vendorSourceMap,
    },
    optimization: {
      styles: stylesOptimization,
      scripts: scriptsOptimization,
    },
  } = buildOptions;

  const extraPlugins: { apply(compiler: Compiler): void }[] = [];
  const extraRules: RuleSetRule[] = [];
  const entryPoints: { [key: string]: [string, ...string[]] } = {};

  // determine hashing format
  const hashFormat = getOutputHashFormat(buildOptions.outputHashing || 'none');

  const targetInFileName = getEsVersionForFileName(
    tsConfig.options.target,
    buildOptions.differentialLoadingMode,
  );

  if (buildOptions.main) {
    const mainPath = path.resolve(root, buildOptions.main);
    entryPoints['main'] = [mainPath];

    if (buildOptions.experimentalRollupPass) {
      // NOTE: the following are known problems with experimentalRollupPass
      // - vendorChunk, commonChunk, namedChunks: these won't work, because by the time webpack
      // sees the chunks, the context of where they came from is lost.
      // - webWorkerTsConfig: workers must be imported via a root relative path (e.g.
      // `app/search/search.worker`) instead of a relative path (`/search.worker`) because
      // of the same reason as above.
      // - loadChildren string syntax: doesn't work because rollup cannot follow the imports.

      // Rollup options, except entry module, which is automatically inferred.
      const rollupOptions: RollupOptions = {};

      // Add rollup plugins/rules.
      extraRules.push({
        test: mainPath,
        // Ensure rollup loader executes after other loaders.
        enforce: 'post',
        use: [{
          loader: WebpackRollupLoader,
          options: rollupOptions,
        }],
      });

      // Rollup bundles will include the dynamic System.import that was inside Angular and webpack
      // will emit warnings because it can't resolve it. We just ignore it.
      // TODO: maybe use https://webpack.js.org/configuration/stats/#statswarningsfilter instead.

      // Ignore all "Critical dependency: the request of a dependency is an expression" warnings.
      extraPlugins.push(new ContextReplacementPlugin(/./));
      // Ignore "System.import() is deprecated" warnings for the main file and js files.
      // Might still get them if @angular/core gets split into a lazy module.
      extraRules.push({
        test: mainPath,
        enforce: 'post',
        parser: { system: true },
      });
      extraRules.push({
        test: /\.js$/,
        enforce: 'post',
        parser: { system: true },
      });
    }
  }

  const differentialLoadingMode = buildOptions.differentialLoadingMode;
  if (platform !== 'server') {
    if (differentialLoadingMode || tsConfig.options.target === ScriptTarget.ES5) {
      const buildBrowserFeatures = new BuildBrowserFeatures(
        projectRoot,
      );

      if (buildBrowserFeatures.isEs5SupportNeeded()) {
        const polyfillsChunkName = 'polyfills-es5';
        entryPoints[polyfillsChunkName] = [path.join(__dirname, '..', 'es5-polyfills.js')];
        if (differentialLoadingMode) {
          // Add zone.js legacy support to the es5 polyfills
          // This is a noop execution-wise if zone-evergreen is not used.
          entryPoints[polyfillsChunkName].push('zone.js/dist/zone-legacy');

          // Since the chunkFileName option schema does not allow the function overload, add a plugin
          // that changes the name of the ES5 polyfills chunk to not include ES2015.
          extraPlugins.push({
            apply(compiler) {
              compiler.hooks.compilation.tap('build-angular', compilation => {
                const assetPath = (
                  filename: string | ((data: { chunk: compilation.Chunk }) => string),
                  data: { chunk: compilation.Chunk },
                ) => {
                  const assetName = typeof filename === 'function' ? filename(data) : filename;
                  const isMap = assetName?.endsWith('.map');

                  return data.chunk?.name === 'polyfills-es5'
                    ? `polyfills-es5${hashFormat.chunk}.js${isMap ? '.map' : ''}`
                    : assetName;
                };

                if (isWebpackFiveOrHigher()) {
                  compilation.hooks.assetPath.tap('remove-hash-plugin', assetPath);
                } else {
                  const mainTemplate = compilation.mainTemplate as typeof compilation.mainTemplate & {
                    hooks: typeof compilation['hooks'];
                  };
                  mainTemplate.hooks.assetPath.tap('build-angular', assetPath);
                }
              });
            },
          });
        }
        if (!buildOptions.aot) {
          if (differentialLoadingMode) {
            entryPoints[polyfillsChunkName].push(path.join(__dirname, '..', 'jit-polyfills.js'));
          }
          entryPoints[polyfillsChunkName].push(path.join(__dirname, '..', 'es5-jit-polyfills.js'));
        }
        // If not performing a full differential build the polyfills need to be added to ES5 bundle
        if (buildOptions.polyfills) {
          entryPoints[polyfillsChunkName].push(path.resolve(root, buildOptions.polyfills));
        }
      }
    }

    if (buildOptions.polyfills) {
      const projectPolyfills = path.resolve(root, buildOptions.polyfills);
      if (entryPoints['polyfills']) {
        entryPoints['polyfills'].push(projectPolyfills);
      } else {
        entryPoints['polyfills'] = [projectPolyfills];
      }
    }

    if (!buildOptions.aot) {
      const jitPolyfills = path.join(__dirname, '..', 'jit-polyfills.js');
      if (entryPoints['polyfills']) {
        entryPoints['polyfills'].push(jitPolyfills);
      } else {
        entryPoints['polyfills'] = [jitPolyfills];
      }
    }
  }

  if (profilingEnabled) {
    extraPlugins.push(
      new debug.ProfilingPlugin({
        outputPath: path.resolve(root, 'chrome-profiler-events.json'),
      }),
    );
  }

  // process global scripts
  const globalScriptsByBundleName = normalizeExtraEntryPoints(
    buildOptions.scripts,
    'scripts',
  ).reduce((prev: { bundleName: string; paths: string[]; inject: boolean }[], curr) => {
    const { bundleName, inject, input } = curr;
    let resolvedPath = path.resolve(root, input);

    if (!existsSync(resolvedPath)) {
      try {
        resolvedPath = require.resolve(input, { paths: [root] });
      } catch {
        throw new Error(`Script file ${input} does not exist.`);
      }
    }

    const existingEntry = prev.find(el => el.bundleName === bundleName);
    if (existingEntry) {
      if (existingEntry.inject && !inject) {
        // All entries have to be lazy for the bundle to be lazy.
        throw new Error(
          `The ${bundleName} bundle is mixing injected and non-injected scripts.`,
        );
      }

      existingEntry.paths.push(resolvedPath);
    } else {
      prev.push({
        bundleName,
        inject,
        paths: [resolvedPath],
      });
    }

    return prev;
  }, []);

    // Add a new asset for each entry.
  for (const script of globalScriptsByBundleName) {
    // Lazy scripts don't get a hash, otherwise they can't be loaded by name.
    const hash = script.inject ? hashFormat.script : '';
    const bundleName = script.bundleName;

    extraPlugins.push(new ScriptsWebpackPlugin({
      name: bundleName,
      sourceMap: scriptsSourceMap,
      filename: `${path.basename(bundleName)}${hash}.js`,
      scripts: script.paths,
      basePath: projectRoot,
    }));
  }

  // process asset entries
  if (buildOptions.assets.length) {
    const copyWebpackPluginPatterns = buildOptions.assets.map((asset: AssetPatternClass) => {
      // Resolve input paths relative to workspace root and add slash at the end.
      // tslint:disable-next-line: prefer-const
      let { input, output, ignore = [], glob } = asset;
      input = path.resolve(root, input).replace(/\\/g, '/');
      input = input.endsWith('/') ? input : input + '/';
      output = output.endsWith('/') ? output : output + '/';

      if (output.startsWith('..')) {
        throw new Error('An asset cannot be written to a location outside of the output path.');
      }

      return {
        context: input,
        // Now we remove starting slash to make Webpack place it from the output root.
        to: output.replace(/^\//, ''),
        from: glob,
        noErrorOnMissing: true,
        force: true,
        globOptions: {
          dot: true,
          followSymbolicLinks: !!asset.followSymlinks,
          ignore: [
            '.gitkeep',
            '**/.DS_Store',
            '**/Thumbs.db',
            // Negate patterns needs to be absolute because copy-webpack-plugin uses absolute globs which
            // causes negate patterns not to match.
            // See: https://github.com/webpack-contrib/copy-webpack-plugin/issues/498#issuecomment-639327909
            ...ignore,
          ].map(i => path.posix.join(input, i)),
        },
      };
    });

    extraPlugins.push(new CopyWebpackPlugin({
      patterns: copyWebpackPluginPatterns,
    }));
  }

  if (buildOptions.progress) {
    const ProgressPlugin = require('webpack/lib/ProgressPlugin');
    const spinner = new Spinner();

    extraPlugins.push(new ProgressPlugin({
      handler: (percentage: number, message: string) => {
        switch (percentage) {
          case 0:
            spinner.start(`Generating ${platform} application bundles...`);
            break;
          case 1:
            spinner.succeed(`${platform.replace(/^\w/, s => s.toUpperCase())} application bundle generation complete.`);
            break;
          default:
            spinner.text = `Generating ${platform} application bundles (phase: ${message})...`;
            break;
        }
      },
    }));
  }

  if (buildOptions.showCircularDependencies) {
    const CircularDependencyPlugin = require('circular-dependency-plugin');
    extraPlugins.push(
      new CircularDependencyPlugin({
        exclude: /([\\\/]node_modules[\\\/])|(ngfactory\.js$)/,
      }),
    );
  }

  if (buildOptions.statsJson) {
    extraPlugins.push(
      new (class {
        apply(compiler: Compiler) {
          compiler.hooks.emit.tap('angular-cli-stats', compilation => {
            const data = JSON.stringify(compilation.getStats().toJson('verbose'), undefined, 2);
            compilation.assets['stats.json'] = new RawSource(data);
          });
        }
      })(),
    );
  }

  if (buildOptions.namedChunks && !isWebpackFiveOrHigher()) {
    extraPlugins.push(new NamedLazyChunksPlugin());

    // Provide full names for lazy routes that use the deprecated string format
    extraPlugins.push(
      new ContextReplacementPlugin(
        /\@angular[\\\/]core[\\\/]/,
        (data: { chunkName?: string }) => (data.chunkName = '[request]'),
      ),
    );
  }

  if (!differentialLoadingMode) {
    // Budgets are computed after differential builds, not via a plugin.
    // https://github.com/angular/angular-cli/blob/master/packages/angular_devkit/build_angular/src/browser/index.ts
    extraPlugins.push(new BundleBudgetPlugin({ budgets: buildOptions.budgets }));
  }

  if ((scriptsSourceMap || stylesSourceMap)) {
    extraRules.push({
      test: /\.m?js$/,
      exclude: vendorSourceMap
        ? /(ngfactory|ngstyle)\.js$/
        : [/[\\\/]node_modules[\\\/]/, /(ngfactory|ngstyle)\.js$/],
      enforce: 'pre',
      loader: require.resolve('source-map-loader'),
    });
  }

  let buildOptimizerUseRule: RuleSetLoader[] = [];
  if (buildOptions.buildOptimizer) {
    extraPlugins.push(new BuildOptimizerWebpackPlugin());
    buildOptimizerUseRule = [
      {
        loader: buildOptimizerLoaderPath,
        options: { sourceMap: scriptsSourceMap },
      },
    ];
  }

  const extraMinimizers = [];
  if (stylesOptimization.minify) {
    extraMinimizers.push(
      new OptimizeCssWebpackPlugin({
        sourceMap: stylesSourceMap,
        // component styles retain their original file name
        test: file => /\.(?:css|scss|sass|less|styl)$/.test(file),
      }),
    );
  }

  if (scriptsOptimization) {
    const { GLOBAL_DEFS_FOR_TERSER, GLOBAL_DEFS_FOR_TERSER_WITH_AOT } = require('@angular/compiler-cli');
    const angularGlobalDefinitions = buildOptions.aot
      ? GLOBAL_DEFS_FOR_TERSER_WITH_AOT
      : GLOBAL_DEFS_FOR_TERSER;

    // TODO: Investigate why this fails for some packages: wco.supportES2015 ? 6 : 5;
    const terserEcma = 5;

    const terserOptions = {
      warnings: !!buildOptions.verbose,
      safari10: true,
      output: {
        ecma: terserEcma,
        // For differential loading, this is handled in the bundle processing.
        // This should also work with just true but the experimental rollup support breaks without this check.
        ascii_only: !differentialLoadingMode,
        // default behavior (undefined value) is to keep only important comments (licenses, etc.)
        comments: !buildOptions.extractLicenses && undefined,
        webkit: true,
        beautify: shouldBeautify,
        wrap_func_args: false,
      },
      // On server, we don't want to compress anything. We still set the ngDevMode = false for it
      // to remove dev code, and ngI18nClosureMode to remove Closure compiler i18n code
      compress:
        allowMinify &&
        (platform === 'server'
          ? {
            ecma: terserEcma,
            global_defs: angularGlobalDefinitions,
            keep_fnames: true,
          }
          : {
            ecma: terserEcma,
            pure_getters: buildOptions.buildOptimizer,
            // PURE comments work best with 3 passes.
            // See https://github.com/webpack/webpack/issues/2899#issuecomment-317425926.
            passes: buildOptions.buildOptimizer ? 3 : 1,
            global_defs: angularGlobalDefinitions,
            pure_funcs: ['forwardRef'],
          }),
      // We also want to avoid mangling on server.
      // Name mangling is handled within the browser builder
      mangle: allowMangle && platform !== 'server' && !differentialLoadingMode,
    };

    const globalScriptsNames = globalScriptsByBundleName.map(s => s.bundleName);
    extraMinimizers.push(
      new TerserPlugin({
        sourceMap: scriptsSourceMap,
        parallel: maxWorkers,
        cache: !cachingDisabled && findCachePath('terser-webpack'),
        extractComments: false,
        exclude: globalScriptsNames,
        terserOptions,
      }),
      // Script bundles are fully optimized here in one step since they are never downleveled.
      // They are shared between ES2015 & ES5 outputs so must support ES5.
      new TerserPlugin({
        sourceMap: scriptsSourceMap,
        parallel: maxWorkers,
        cache: !cachingDisabled && findCachePath('terser-webpack'),
        extractComments: false,
        include: globalScriptsNames,
        terserOptions: {
          ...terserOptions,
          compress: allowMinify && {
            ...terserOptions.compress,
            ecma: 5,
          },
          output: {
            ...terserOptions.output,
            ecma: 5,
          },
          mangle: allowMangle && platform !== 'server',
        },
      }),
    );
  }

  return {
    mode: scriptsOptimization || stylesOptimization.minify ? 'production' : 'development',
    devtool: false,
    profile: buildOptions.statsJson,
    resolve: {
      roots: [projectRoot],
      extensions: ['.ts', '.tsx', '.mjs', '.js'],
      symlinks: !buildOptions.preserveSymlinks,
      modules: [wco.tsConfig.options.baseUrl || projectRoot, 'node_modules'],
      plugins: isWebpackFiveOrHigher() ? [] : [PnpWebpackPlugin],
    },
    resolveLoader: {
      symlinks: !buildOptions.preserveSymlinks,
      modules: [
        // Allow loaders to be in a node_modules nested inside the devkit/build-angular package.
        // This is important in case loaders do not get hoisted.
        // If this file moves to another location, alter potentialNodeModules as well.
        'node_modules',
        ...findAllNodeModules(__dirname, projectRoot),
      ],
      plugins: isWebpackFiveOrHigher() ? [] : [PnpWebpackPlugin.moduleLoader(module)],
    },
    context: root,
    entry: entryPoints,
    output: {
      ...withWebpackFourOrFive({ futureEmitAssets: true }, {}),
      path: path.resolve(root, buildOptions.outputPath),
      publicPath: buildOptions.deployUrl,
      filename: `[name]${targetInFileName}${hashFormat.chunk}.js`,
    },
    watch: buildOptions.watch,
    watchOptions: getWatchOptions(buildOptions.poll),
    performance: {
      hints: false,
    },
    ...withWebpackFourOrFive({}, { ignoreWarnings: IGNORE_WARNINGS }),
    module: {
      // Show an error for missing exports instead of a warning.
      strictExportPresence: true,
      rules: [
        {
          test: /\.(eot|svg|cur|jpg|png|webp|gif|otf|ttf|woff|woff2|ani|avif)$/,
          loader: require.resolve('file-loader'),
          options: {
            name: `[name]${hashFormat.file}.[ext]`,
            // Re-use emitted files from browser builder on the server.
            emitFile: platform !== 'server',
          },
        },
        {
          // Mark files inside `@angular/core` as using SystemJS style dynamic imports.
          // Removing this will cause deprecation warnings to appear.
          test: /[\/\\]@angular[\/\\]core[\/\\].+\.js$/,
          parser: { system: true },
        },
        {
          // Mark files inside `rxjs/add` as containing side effects.
          // If this is fixed upstream and the fixed version becomes the minimum
          // supported version, this can be removed.
          test: /[\/\\]rxjs[\/\\]add[\/\\].+\.js$/,
          sideEffects: true,
        },
        {
          test: /\.m?js$/,
          exclude: [/[\/\\](?:core-js|\@babel|tslib|web-animations-js)[\/\\]/, /(ngfactory|ngstyle)\.js$/],
          use: [
            ...(wco.supportES2015
              ? []
              : [
                  {
                    loader: require.resolve('babel-loader'),
                    options: {
                      babelrc: false,
                      configFile: false,
                      compact: false,
                      cacheCompression: false,
                      cacheDirectory: findCachePath('babel-webpack'),
                      cacheIdentifier: JSON.stringify({
                        buildAngular: require('../../../package.json').version,
                      }),
                      sourceType: 'unambiguous',
                      presets: [
                        [
                          require.resolve('../../babel/presets/application'),
                          {
                            forceES5: true,
                          } as import('../../babel/presets/application').ApplicationPresetOptions,
                        ],
                      ],
                    },
                  },
                ]),
            ...buildOptimizerUseRule,
          ],
        },
        ...extraRules,
      ],
    },
    optimization: {
      minimizer: extraMinimizers,
      moduleIds: withWebpackFourOrFive('hashed', 'deterministic'),
      ...withWebpackFourOrFive({}, buildOptions.namedChunks ? { chunkIds: 'named' } : {}),
      ...withWebpackFourOrFive({ noEmitOnErrors: true }, { emitOnErrors: false }),
    },
    plugins: [
      // Always replace the context for the System.import in angular/core to prevent warnings.
      // https://github.com/angular/angular/issues/11580
      // With VE the correct context is added in @ngtools/webpack, but Ivy doesn't need it at all.
      new ContextReplacementPlugin(/\@angular(\\|\/)core(\\|\/)/),
      new DedupeModuleResolvePlugin({ verbose: buildOptions.verbose }),
      ...extraPlugins,
    ],
  };
}
