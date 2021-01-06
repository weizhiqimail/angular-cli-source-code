/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import {
  BuilderContext,
  BuilderOutput,
  createBuilder,
  targetFromTargetString,
} from '@angular-devkit/architect';
import { JsonObject, normalize, resolve } from '@angular-devkit/core';
import { NodeJsSyncHost } from '@angular-devkit/core/node';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserBuilderOutput } from '../browser';
import { Schema as BrowserBuilderSchema } from '../browser/schema';
import { ServerBuilderOutput } from '../server';
import { normalizeOptimization } from '../utils';
import { readFile, writeFile } from '../utils/fs';
import { InlineCriticalCssProcessor } from '../utils/index-file/inline-critical-css';
import { augmentAppWithServiceWorker } from '../utils/service-worker';
import { Spinner } from '../utils/spinner';
import { Schema as BuildWebpackAppShellSchema } from './schema';

async function _renderUniversal(
  options: BuildWebpackAppShellSchema,
  context: BuilderContext,
  browserResult: BrowserBuilderOutput,
  serverResult: ServerBuilderOutput,
  spinner: Spinner,
): Promise<BrowserBuilderOutput> {
  // Get browser target options.
  const browserTarget = targetFromTargetString(options.browserTarget);
  const rawBrowserOptions = (await context.getTargetOptions(browserTarget)) as JsonObject & BrowserBuilderSchema;
  const browserBuilderName = await context.getBuilderNameForTarget(browserTarget);
  const browserOptions = await context.validateOptions<JsonObject & BrowserBuilderSchema>(
    rawBrowserOptions,
    browserBuilderName,
  );


  // Initialize zone.js
  const root = context.workspaceRoot;
  const zonePackage = require.resolve('zone.js', { paths: [root] });
  await import(zonePackage);

  const host = new NodeJsSyncHost();
  const projectName = context.target && context.target.project;
  if (!projectName) {
    throw new Error('The builder requires a target.');
  }

  const projectMetadata = await context.getProjectMetadata(projectName);
  const projectRoot = resolve(
    normalize(root),
    normalize((projectMetadata.root as string) || ''),
  );

  const { styles } = normalizeOptimization(browserOptions.optimization);
  const inlineCriticalCssProcessor = styles.inlineCritical
    ? new InlineCriticalCssProcessor({
      minify: styles.minify,
      deployUrl: browserOptions.deployUrl,
    })
    : undefined;

  for (const outputPath of browserResult.outputPaths) {
    const localeDirectory = path.relative(browserResult.baseOutputPath, outputPath);
    const browserIndexOutputPath = path.join(outputPath, 'index.html');
    const indexHtml = await readFile(browserIndexOutputPath, 'utf8');
    const serverBundlePath = await _getServerModuleBundlePath(options, context, serverResult, localeDirectory);

    const {
      AppServerModule,
      AppServerModuleNgFactory,
      renderModule,
      renderModuleFactory,
    } = await import(serverBundlePath);

    let renderModuleFn: (module: unknown, options: {}) => Promise<string>;
    let AppServerModuleDef: unknown;

    if (renderModuleFactory && AppServerModuleNgFactory) {
      renderModuleFn = renderModuleFactory;
      AppServerModuleDef = AppServerModuleNgFactory;
    } else if (renderModule && AppServerModule) {
      renderModuleFn = renderModule;
      AppServerModuleDef = AppServerModule;
    } else {
      throw new Error(`renderModule method and/or AppServerModule were not exported from: ${serverBundlePath}.`);
    }

    // Load platform server module renderer
    const renderOpts = {
      document: indexHtml,
      url: options.route,
    };

    let html = await renderModuleFn(AppServerModuleDef, renderOpts);
    // Overwrite the client index file.
    const outputIndexPath = options.outputIndexPath
      ? path.join(root, options.outputIndexPath)
      : browserIndexOutputPath;

    if (inlineCriticalCssProcessor) {
      const { content, warnings, errors } = await inlineCriticalCssProcessor.process(html, { outputPath });
      html = content;

      if (warnings.length || errors.length) {
        spinner.stop();
        warnings.forEach(m => context.logger.warn(m));
        errors.forEach(m => context.logger.error(m));
        spinner.start();
      }
    }

    await writeFile(outputIndexPath, html);

    if (browserOptions.serviceWorker) {
      await augmentAppWithServiceWorker(
        host,
        normalize(root),
        projectRoot,
        normalize(outputPath),
        browserOptions.baseHref || '/',
        browserOptions.ngswConfigPath,
      );
    }
  }

  return browserResult;
}

async function _getServerModuleBundlePath(
  options: BuildWebpackAppShellSchema,
  context: BuilderContext,
  serverResult: ServerBuilderOutput,
  browserLocaleDirectory: string,
) {
  if (options.appModuleBundle) {
    return path.join(context.workspaceRoot, options.appModuleBundle);
  }

  const { baseOutputPath = '' } = serverResult;
  const outputPath = path.join(baseOutputPath, browserLocaleDirectory);

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Could not find server output directory: ${outputPath}.`);
  }

  const re = /^main\.(?:[a-zA-Z0-9]{20}\.)?js$/;
  const maybeMain = fs.readdirSync(outputPath).find(x => re.test(x));

  if (!maybeMain) {
    throw new Error('Could not find the main bundle.');
  }

  return path.join(outputPath, maybeMain);
}

async function _appShellBuilder(
  options: JsonObject & BuildWebpackAppShellSchema,
  context: BuilderContext,
): Promise<BuilderOutput> {
  const browserTarget = targetFromTargetString(options.browserTarget);
  const serverTarget = targetFromTargetString(options.serverTarget);

  // Never run the browser target in watch mode.
  // If service worker is needed, it will be added in _renderUniversal();
  const browserOptions = (await context.getTargetOptions(browserTarget)) as JsonObject & BrowserBuilderSchema;

  const optimization = normalizeOptimization(browserOptions.optimization);
  optimization.styles.inlineCritical = false;

  const browserTargetRun = await context.scheduleTarget(browserTarget, {
    watch: false,
    serviceWorker: false,
    optimization: (optimization as unknown as JsonObject),
  });
  const serverTargetRun = await context.scheduleTarget(serverTarget, {
    watch: false,
  });

  let spinner: Spinner | undefined;

  try {
    const [browserResult, serverResult] = await Promise.all([
      browserTargetRun.result as unknown as BrowserBuilderOutput,
      serverTargetRun.result as unknown as ServerBuilderOutput,
    ]);

    if (browserResult.success === false || browserResult.baseOutputPath === undefined) {
      return browserResult;
    } else if (serverResult.success === false) {
      return serverResult;
    }

    spinner = new Spinner();
    spinner.start('Generating application shell...');
    const result = await _renderUniversal(options, context, browserResult, serverResult, spinner);
    spinner.succeed('Application shell generation complete.');

    return result;
  } catch (err) {
    spinner?.fail('Application shell generation failed.');

    return { success: false, error: err.message };
  } finally {
    // Just be good citizens and stop those jobs.
    await Promise.all([browserTargetRun.stop(), serverTargetRun.stop()]);
  }
}

export default createBuilder(_appShellBuilder);
