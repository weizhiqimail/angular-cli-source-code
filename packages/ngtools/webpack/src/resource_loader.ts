/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
// TODO: fix typings.
// tslint:disable-next-line:no-global-tslint-disable
// tslint:disable:no-any
import * as path from 'path';
import * as vm from 'vm';
import { RawSource } from 'webpack-sources';
import { normalizePath } from './ivy/paths';

const NodeTemplatePlugin = require('webpack/lib/node/NodeTemplatePlugin');
const NodeTargetPlugin = require('webpack/lib/node/NodeTargetPlugin');
const LibraryTemplatePlugin = require('webpack/lib/LibraryTemplatePlugin');
const SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');


interface CompilationOutput {
  outputName: string;
  source: string;
}

export class WebpackResourceLoader {
  private _parentCompilation: any;
  private _context = '';
  private _fileDependencies = new Map<string, Set<string>>();
  private _reverseDependencies = new Map<string, Set<string>>();
  private _cachedSources = new Map<string, string>();
  private _cachedEvaluatedSources = new Map<string, RawSource>();

  public changedFiles?: Iterable<string>;

  update(parentCompilation: import('webpack').compilation.Compilation, changedFiles?: Iterable<string>) {
    this._parentCompilation = parentCompilation;
    this._context = parentCompilation.context;

    // Update changed file list
    this.changedFiles = changedFiles;
  }

  getModifiedResourceFiles() {
    const modifiedResources = new Set<string>();
    if (!this.changedFiles) {
      return modifiedResources;
    }

    for (const changedFile of this.changedFiles) {
      this.getAffectedResources(
        changedFile,
      ).forEach((affected: string) => modifiedResources.add(affected));
    }

    return modifiedResources;
  }

  getResourceDependencies(filePath: string) {
    return this._fileDependencies.get(filePath) || [];
  }

  getAffectedResources(file: string) {
    return this._reverseDependencies.get(file) || [];
  }

  setAffectedResources(file: string, resources: Iterable<string>) {
    this._reverseDependencies.set(file, new Set(resources));
  }

  private async _compile(filePath: string): Promise<CompilationOutput> {

    if (!this._parentCompilation) {
      throw new Error('WebpackResourceLoader cannot be used without parentCompilation');
    }

    // Simple sanity check.
    if (filePath.match(/\.[jt]s$/)) {
      return Promise.reject(
        `Cannot use a JavaScript or TypeScript file (${filePath}) in a component's styleUrls or templateUrl.`,
      );
    }

    const outputOptions = { filename: filePath };
    const relativePath = path.relative(this._context || '', filePath);
    const childCompiler = this._parentCompilation.createChildCompiler(relativePath, outputOptions);
    childCompiler.context = this._context;

    new NodeTemplatePlugin(outputOptions).apply(childCompiler);
    new NodeTargetPlugin().apply(childCompiler);
    new SingleEntryPlugin(this._context, filePath).apply(childCompiler);
    new LibraryTemplatePlugin('resource', 'var').apply(childCompiler);

    childCompiler.hooks.thisCompilation.tap('ngtools-webpack', (compilation: any) => {
      compilation.hooks.additionalAssets.tapAsync('ngtools-webpack',
      (callback: (err?: Error) => void) => {
        if (this._cachedEvaluatedSources.has(compilation.fullHash)) {
          const cachedEvaluatedSource = this._cachedEvaluatedSources.get(compilation.fullHash);
          compilation.assets[filePath] = cachedEvaluatedSource;
          callback();

          return;
        }

        const asset = compilation.assets[filePath];
        if (asset) {
          this._evaluate({ outputName: filePath, source: asset.source() })
            .then(output => {
              const evaluatedSource = new RawSource(output);
              this._cachedEvaluatedSources.set(compilation.fullHash, evaluatedSource);
              compilation.assets[filePath] = evaluatedSource;
              callback();
            })
            .catch(err => callback(err));
        } else {
          callback();
        }
      });
    });

    // Compile and return a promise
    const childCompilation = await new Promise<any>((resolve, reject) => {
      childCompiler.compile((err: Error, childCompilation: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(childCompilation);
        }
      });
    });

    // Propagate warnings to parent compilation.
    const { warnings, errors } = childCompilation;
    if (warnings && warnings.length) {
      this._parentCompilation.warnings.push(...warnings);
    }
    if (errors && errors.length) {
      this._parentCompilation.errors.push(...errors);
    }

    Object.keys(childCompilation.assets).forEach(assetName => {
      // Add all new assets to the parent compilation, with the exception of
      // the file we're loading and its sourcemap.
      if (
        assetName !== filePath
        && assetName !== `${filePath}.map`
        && this._parentCompilation.assets[assetName] == undefined
      ) {
        this._parentCompilation.assets[assetName] = childCompilation.assets[assetName];
      }
    });

    // Save the dependencies for this resource.
    this._fileDependencies.set(filePath, new Set(childCompilation.fileDependencies));
    for (const file of childCompilation.fileDependencies) {
      const resolvedFile = normalizePath(file);
      const entry = this._reverseDependencies.get(resolvedFile);
      if (entry) {
        entry.add(filePath);
      } else {
        this._reverseDependencies.set(resolvedFile, new Set([filePath]));
      }
    }

    const compilationHash = childCompilation.fullHash;
    const maybeSource = this._cachedSources.get(compilationHash);
    if (maybeSource) {
      return { outputName: filePath, source: maybeSource };
    } else {
      const source = childCompilation.assets[filePath].source();
      this._cachedSources.set(compilationHash, source);

      return { outputName: filePath, source };
    }
  }

  private async _evaluate({ outputName, source }: CompilationOutput): Promise<string> {
      // Evaluate code
      const context: { resource?: string | { default?: string } } = {};
      vm.runInNewContext(source, context, { filename: outputName });

      if (typeof context.resource === 'string') {
        return context.resource;
      } else if (typeof context.resource?.default === 'string') {
        return context.resource.default;
      }

      throw new Error(`The loader "${outputName}" didn't return a string.`);
  }

  get(filePath: string): Promise<string> {
    return this._compile(filePath)
      .then((result: CompilationOutput) => result.source);
  }
}
