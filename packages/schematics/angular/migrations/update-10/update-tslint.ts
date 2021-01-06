/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */
import { JsonValue } from '@angular-devkit/core';
import { Rule } from '@angular-devkit/schematics';
import { addPackageJsonDependency, getPackageJsonDependency } from '../../utility/dependencies';
import { JSONFile } from '../../utility/json-file';

export const TSLINT_VERSION = '~6.1.0';
const TSLINT_CONFIG_PATH = '/tslint.json';

const RULES_TO_DELETE: string[] = [
  'no-use-before-declare',
  'no-unused-variable',
];

const RULES_TO_ADD: Record<string, JsonValue> = {
  align: {
    options: ['parameters', 'statements'],
  },
  'arrow-return-shorthand': true,
  curly: true,
  eofline: true,
  'import-spacing': true,
  indent: {
    options: ['spaces'],
  },
  'variable-name': {
    options: ['ban-keywords', 'check-format', 'allow-pascal-case'],
  },
  semicolon: { options: ['always'] },
  'space-before-function-paren': {
    options: {
      anonymous: 'never',
      asyncArrow: 'always',
      constructor: 'never',
      method: 'never',
      named: 'never',
    },
  },
  'typedef-whitespace': {
    options: [
      {
        'call-signature': 'nospace',
        'index-signature': 'nospace',
        parameter: 'nospace',
        'property-declaration': 'nospace',
        'variable-declaration': 'nospace',
      },
      {
        'call-signature': 'onespace',
        'index-signature': 'onespace',
        parameter: 'onespace',
        'property-declaration': 'onespace',
        'variable-declaration': 'onespace',
      },
    ],
  },
  whitespace: {
    options: [
      'check-branch',
      'check-decl',
      'check-operator',
      'check-separator',
      'check-type',
      'check-typecast',
    ],
  },
};

export default function (): Rule {
  return (tree, context) => {
    const logger = context.logger;

    // Update tslint dependency
    const current = getPackageJsonDependency(tree, 'tslint');

    if (!current) {
      logger.info('"tslint" in not a dependency of this workspace.');

      return;
    }

    if (current.version !== TSLINT_VERSION) {
      addPackageJsonDependency(tree, {
        type: current.type,
        name: 'tslint',
        version: TSLINT_VERSION,
        overwrite: true,
      });
    }

    // Update tslint config.
    let json;
    try {
      json = new JSONFile(tree, TSLINT_CONFIG_PATH);
    } catch {
      const config = ['tslint.js', 'tslint.yaml'].find(c => tree.exists(c));
      if (config) {
        logger.warn(`Expected a JSON configuration file but found "${config}".`);
      } else {
        logger.warn('Cannot find "tslint.json" configuration file.');
      }

      return;
    }

    // Remove old/deprecated rules.
    for (const rule of RULES_TO_DELETE) {
      json.remove(['rules', rule]);
    }

    // Add new rules only iif the configuration extends 'tslint:recommended'.
    // This is because some rules conflict with prettier or other tools.
    const extend = json.get(['extends']);
    if (
      extend !== 'tslint:recommended' || (Array.isArray(extend) && extend.some(e => e.value !== 'tslint:recommended'))
    ) {
      logger.warn(`tslint configuration does not extend "tslint:recommended" or it extends multiple configurations.`
        + '\nSkipping rule changes as some rules might conflict.');

      return;
    }

    for (const [name, value] of Object.entries(RULES_TO_ADD)) {
      const ruleName = ['rules', name];
      if (json.get(ruleName) === undefined) {
        json.modify(ruleName, value);
      }
    }
  };
}
