/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import * as path from 'path';

export type DiagnosticReporter = (type: 'error' | 'warning', message: string) => void;
export interface ApplicationPresetOptions {
  i18n?: {
    locale: string;
    missingTranslationBehavior?: 'error' | 'warning' | 'ignore';
    translation?: unknown;
  };

  forceES5?: boolean;
  forceAsyncTransformation?: boolean;

  diagnosticReporter?: DiagnosticReporter;
}

type I18nDiagnostics = import('@angular/localize/src/tools/src/diagnostics').Diagnostics;
function createI18nDiagnostics(reporter: DiagnosticReporter | undefined): I18nDiagnostics {
  // Babel currently is synchronous so import cannot be used
  const diagnostics: I18nDiagnostics = new (require('@angular/localize/src/tools/src/diagnostics').Diagnostics)();

  if (!reporter) {
    return diagnostics;
  }

  const baseAdd = diagnostics.add;
  diagnostics.add = function (type, message, ...args) {
    if (type !== 'ignore') {
      baseAdd.call(diagnostics, type, message, ...args);
      reporter(type, message);
    }
  };

  const baseError = diagnostics.error;
  diagnostics.error = function (message, ...args) {
    baseError.call(diagnostics, message, ...args);
    reporter('error', message);
  };

  const baseWarn = diagnostics.warn;
  diagnostics.warn = function (message, ...args) {
    baseWarn.call(diagnostics, message, ...args);
    reporter('warning', message);
  };

  const baseMerge = diagnostics.merge;
  diagnostics.merge = function (other, ...args) {
    baseMerge.call(diagnostics, other, ...args);
    for (const diagnostic of other.messages) {
      reporter(diagnostic.type, diagnostic.message);
    }
  };

  return diagnostics;
}

function createI18nPlugins(
  locale: string,
  translation: unknown | undefined,
  missingTranslationBehavior: 'error' | 'warning' | 'ignore',
  diagnosticReporter: DiagnosticReporter | undefined,
) {
  const diagnostics = createI18nDiagnostics(diagnosticReporter);
  const plugins = [];

  if (translation) {
    const {
      makeEs2015TranslatePlugin,
    } = require('@angular/localize/src/tools/src/translate/source_files/es2015_translate_plugin');
    plugins.push(
      makeEs2015TranslatePlugin(diagnostics, translation, {
        missingTranslation: missingTranslationBehavior,
      }),
    );

    const {
      makeEs5TranslatePlugin,
    } = require('@angular/localize/src/tools/src/translate/source_files/es5_translate_plugin');
    plugins.push(
      makeEs5TranslatePlugin(diagnostics, translation, {
        missingTranslation: missingTranslationBehavior,
      }),
    );
  }

  const {
    makeLocalePlugin,
  } = require('@angular/localize/src/tools/src/translate/source_files/locale_plugin');
  plugins.push(makeLocalePlugin(locale));

  return plugins;
}

export default function (api: unknown, options: ApplicationPresetOptions) {
  const presets = [];
  const plugins = [];
  let needRuntimeTransform = false;

  if (options.forceES5) {
    presets.push([
      require('@babel/preset-env').default,
      {
        bugfixes: true,
        modules: false,
        // Comparable behavior to tsconfig target of ES5
        targets: { ie: 9 },
        exclude: ['transform-typeof-symbol'],
      },
    ]);
    needRuntimeTransform = true;
  }

  if (options.i18n) {
    const { locale, missingTranslationBehavior, translation } = options.i18n;
    const i18nPlugins = createI18nPlugins(
      locale,
      translation,
      missingTranslationBehavior || 'ignore',
      options.diagnosticReporter,
    );

    plugins.push(...i18nPlugins);
  }

  if (options.forceAsyncTransformation) {
    // Always transform async/await to support Zone.js
    // tslint:disable-next-line: no-implicit-dependencies
    plugins.push(require('@babel/plugin-transform-async-to-generator').default);
    needRuntimeTransform = true;
  }

  if (needRuntimeTransform) {
    // Babel equivalent to TypeScript's `importHelpers` option
    plugins.push([
      require('@babel/plugin-transform-runtime').default,
      {
        useESModules: true,
        version: require('@babel/runtime/package.json').version,
        absoluteRuntime: path.dirname(require.resolve('@babel/runtime/package.json')),
      },
    ]);
  }

  return { presets, plugins };
}
