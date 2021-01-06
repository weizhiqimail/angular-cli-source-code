/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { join } from 'path';
import { readFile } from '../fs';
import { NormalizedOptimizationOptions } from '../normalize-optimization';
import { stripBom } from '../strip-bom';
import { CrossOriginValue, FileInfo, augmentIndexHtml } from './augment-index-html';
import { InlineCriticalCssProcessor } from './inline-critical-css';
import { InlineFontsProcessor } from './inline-fonts';

type IndexHtmlGeneratorPlugin = (html: string, options: IndexHtmlGeneratorProcessOptions) => Promise<string | IndexHtmlTransformResult>;

export interface IndexHtmlGeneratorProcessOptions {
  lang: string | undefined;
  baseHref: string | undefined;
  outputPath: string;
  files: FileInfo[];
  noModuleFiles: FileInfo[];
  moduleFiles: FileInfo[];
}

export interface IndexHtmlGeneratorOptions {
  indexPath: string;
  deployUrl?: string;
  sri?: boolean;
  entrypoints: string[];
  postTransform?: IndexHtmlTransform;
  crossOrigin?: CrossOriginValue;
  optimization?: NormalizedOptimizationOptions;
  WOFFSupportNeeded: boolean;
}

export type IndexHtmlTransform = (content: string) => Promise<string>;

export interface IndexHtmlTransformResult {
  content: string;
  warnings: string[];
  errors: string[];
}

export class IndexHtmlGenerator {
  private readonly plugins: IndexHtmlGeneratorPlugin[];

  constructor(readonly options: IndexHtmlGeneratorOptions) {
    const extraPlugins: IndexHtmlGeneratorPlugin[] = [];
    if (this.options.optimization?.fonts.inline) {
      extraPlugins.push(inlineFontsPlugin(this));
    }

    if (this.options.optimization?.styles.inlineCritical) {
      extraPlugins.push(inlineCriticalCssPlugin(this));
    }

    this.plugins = [
      augmentIndexHtmlPlugin(this),
      ...extraPlugins,
      postTransformPlugin(this),
    ];
  }

  async process(options: IndexHtmlGeneratorProcessOptions): Promise<IndexHtmlTransformResult> {
    let content = stripBom(await this.readIndex(this.options.indexPath));
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const plugin of this.plugins) {
      const result = await plugin(content, options);
      if (typeof result === 'string') {
        content = result;
      } else {
        content = result.content;

        if (result.warnings.length) {
          warnings.push(...result.warnings);
        }

        if (result.errors.length) {
          errors.push(...result.errors);
        }
      }
    }

    return {
      content,
      warnings,
      errors,
    };
  }

  async readAsset(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }

  protected async readIndex(path: string): Promise<string> {
    return readFile(path, 'utf-8');
  }
}

function augmentIndexHtmlPlugin(generator: IndexHtmlGenerator): IndexHtmlGeneratorPlugin {
  const {
    deployUrl,
    crossOrigin,
    sri = false,
    entrypoints,
  } = generator.options;

  return async (html, options) => {
    const {
      lang,
      baseHref,
      outputPath = '',
      noModuleFiles,
      files,
      moduleFiles,
    } = options;

    return augmentIndexHtml({
      html,
      baseHref,
      deployUrl,
      crossOrigin,
      sri,
      lang,
      entrypoints,
      loadOutputFile: filePath => generator.readAsset(join(outputPath, filePath)),
      noModuleFiles,
      moduleFiles,
      files,
    });
  };
}

function inlineFontsPlugin({ options }: IndexHtmlGenerator): IndexHtmlGeneratorPlugin {
  const inlineFontsProcessor = new InlineFontsProcessor({
    minify: options.optimization?.styles.minify,
    WOFFSupportNeeded: options.WOFFSupportNeeded,
  });

  return async html => inlineFontsProcessor.process(html);
}


function inlineCriticalCssPlugin(generator: IndexHtmlGenerator): IndexHtmlGeneratorPlugin {
  const inlineCriticalCssProcessor = new InlineCriticalCssProcessor({
    minify: generator.options.optimization?.styles.minify,
    deployUrl: generator.options.deployUrl,
    readAsset: filePath => generator.readAsset(filePath),
  });

  return async (html, options) => inlineCriticalCssProcessor.process(html, { outputPath: options.outputPath });
}

function postTransformPlugin({ options }: IndexHtmlGenerator): IndexHtmlGeneratorPlugin {
  return async html => options.postTransform ? options.postTransform(html) : html;
}
