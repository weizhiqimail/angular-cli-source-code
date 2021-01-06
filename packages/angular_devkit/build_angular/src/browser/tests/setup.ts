/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { Schema } from '../schema';

export { describeBuilder } from '../../testing';

export const BROWSER_BUILDER_INFO = Object.freeze({
  name: '@angular-devkit/build-angular:browser',
  schemaPath: __dirname + '/../schema.json',
});

/**
 * Contains all required browser builder fields.
 * Also disables progress reporting to minimize logging output.
 */
export const BASE_OPTIONS = Object.freeze<Schema>({
  index: 'src/index.html',
  main: 'src/main.ts',
  outputPath: 'dist',
  tsConfig: 'src/tsconfig.app.json',
  progress: false,
});
