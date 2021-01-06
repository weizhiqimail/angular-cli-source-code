import { expectFileNotToExist, expectFileToMatch, readFile, writeFile } from '../../utils/fs';
import { ng } from '../../utils/process';
import { updateJsonFile } from '../../utils/project';
import { expectToFail } from '../../utils/utils';
import { externalServer, langTranslations, setupI18nConfig } from './legacy';

export default async function() {
  // Setup i18n tests and config.
  await setupI18nConfig();

  // Ensure a ES2015 build is used.
  await writeFile('.browserslistrc', 'Chrome 65');
  await updateJsonFile('tsconfig.json', config => {
    config.compilerOptions.target = 'es2015';
    if (!config.angularCompilerOptions) {
      config.angularCompilerOptions = {};
    }
    config.angularCompilerOptions.disableTypeScriptVersionCheck = true;
  });

  await ng('build', '--source-map');
  for (const { lang, outputPath, translation } of langTranslations) {
    await expectFileToMatch(`${outputPath}/main.js`, translation.helloPartial);
    await expectToFail(() => expectFileToMatch(`${outputPath}/main.js`, '$localize`'));
    await expectFileNotToExist(`${outputPath}/main-es5.js`);

    // Ensure sourcemap for modified file contains content
    const mainSourceMap = JSON.parse(await readFile(`${outputPath}/main.js.map`));
    if (
      mainSourceMap.version !== 3 ||
      !Array.isArray(mainSourceMap.sources) ||
      typeof mainSourceMap.mappings !== 'string'
    ) {
      throw new Error('invalid localized sourcemap for main.js');
    }

    // Ensure locale is inlined (@angular/localize plugin inlines `$localize.locale` references)
    // The only reference in a new application is in @angular/core
    await expectFileToMatch(`${outputPath}/vendor.js`, lang);

    // Verify the HTML lang attribute is present
    await expectFileToMatch(`${outputPath}/index.html`, `lang="${lang}"`);

    // Execute Application E2E tests with dev server
    await ng('e2e', `--configuration=${lang}`, '--port=0');

    // Execute Application E2E tests for a production build without dev server
    const server = externalServer(outputPath, `/${lang}/`);
    try {
      await ng(
        'e2e',
        `--configuration=${lang}`,
        '--devServerTarget=',
        `--baseUrl=http://localhost:4200/${lang}/`,
      );
    } finally {
      server.close();
    }
  }
}
