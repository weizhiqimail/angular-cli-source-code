import * as fs from 'fs';
import * as path from 'path';
import { getGlobalVariable } from '../../utils/env';
import { exec, silentNpm } from '../../utils/process';
import { rimraf } from '../../utils/fs';

export default async function () {
  // setup
  const argv = getGlobalVariable('argv');
  if (argv.noglobal) {
    return;
  }

  process.env['NPM_CONFIG_REGISTRY'] = 'http://localhost:4873';

  await silentNpm(
    'install',
    '-g',
    '@angular-devkit/schematics-cli',
    '--registry=http://localhost:4873',
  );
  await exec(process.platform.startsWith('win') ? 'where' : 'which', 'schematics');

  const startCwd = process.cwd();
  const schematicPath = path.join(startCwd, 'test-schematic');

  try {
    // create schematic
    await exec('schematics', 'schematic', '--name', 'test-schematic');

    process.chdir(schematicPath);

    await silentNpm('install');
    await silentNpm('test');
  } finally {
    // restore path
    process.chdir(startCwd);
    await rimraf(schematicPath);
  }
}
