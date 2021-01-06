/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { Architect, BuilderRun } from '@angular-devkit/architect';
import { DevServerBuilderOutput } from '@angular-devkit/build-angular';
import fetch from 'node-fetch'; // tslint:disable-line:no-implicit-dependencies
import { createArchitect, host } from '../test-utils';

describe('Dev Server Builder inline critical CSS optimization', () => {
  const target = { project: 'app', target: 'serve' };
  let architect: Architect;
  let runs: BuilderRun[] = [];

  beforeEach(async () => {
    await host.initialize().toPromise();
    architect = (await createArchitect(host.root())).architect;
    runs = [];

    host.writeMultipleFiles({
      'src/styles.css': `
        body { color: #000 }
      `,
    });
  });

  afterEach(async () => {
    await host.restore().toPromise();
    await Promise.all(runs.map(r => r.stop()));
  });

  it('works', async () => {
    const run = await architect.scheduleTarget(target, { browserTarget: 'app:build:production,inline-critical-css' });
    runs.push(run);
    const output = await run.result as DevServerBuilderOutput;
    expect(output.success).toBe(true);
    const response = await fetch(`${output.baseUrl}/index.html`);
    expect(await response.text()).toContain(`body{color:#000;}`);
  }, 30000);
});
