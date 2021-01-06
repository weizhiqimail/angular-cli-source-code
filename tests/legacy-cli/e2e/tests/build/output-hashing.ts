import { copyProjectAsset } from '../../utils/assets';
import { expectFileMatchToExist, expectFileToMatch, writeMultipleFiles } from '../../utils/fs';
import { ng } from '../../utils/process';


async function verifyMedia(fileNameRe: RegExp, content: RegExp) {
  const fileName = await expectFileMatchToExist('dist/test-project/', fileNameRe);
  await expectFileToMatch(`dist/test-project/${fileName}`, content);
}

export default async function () {
  await writeMultipleFiles({
    'src/styles.css': 'body { background-image: url("./assets/image.png"); }',
  });
  // use image with file size >10KB to prevent inlining
  await copyProjectAsset('images/spectrum.png', './src/assets/image.png');
  await ng('build', '--output-hashing=all');
  await expectFileToMatch('dist/test-project/index.html', /runtime\.[0-9a-f]{20}\.js/);
  await expectFileToMatch('dist/test-project/index.html', /main\.[0-9a-f]{20}\.js/);
  await expectFileToMatch('dist/test-project/index.html', /styles\.[0-9a-f]{20}\.(css|js)/);
  await verifyMedia(/styles\.[0-9a-f]{20}\.(css|js)/, /image\.[0-9a-f]{20}\.png/);

  await ng('build', '--output-hashing=none');
  await expectFileToMatch('dist/test-project/index.html', /runtime\.js/);
  await expectFileToMatch('dist/test-project/index.html', /main\.js/);
  await expectFileToMatch('dist/test-project/index.html', /styles\.(css|js)/);
  await verifyMedia(/styles\.(css|js)/, /image\.png/);

  await ng('build', '--output-hashing=media');
  await expectFileToMatch('dist/test-project/index.html', /runtime\.js/);
  await expectFileToMatch('dist/test-project/index.html', /main\.js/);
  await expectFileToMatch('dist/test-project/index.html', /styles\.(css|js)/);
  await verifyMedia(/styles\.(css|js)/, /image\.[0-9a-f]{20}\.png/);

  await ng('build', '--output-hashing=bundles');
  await expectFileToMatch('dist/test-project/index.html', /runtime\.[0-9a-f]{20}\.js/);
  await expectFileToMatch('dist/test-project/index.html', /main\.[0-9a-f]{20}\.js/);
  await expectFileToMatch('dist/test-project/index.html', /styles\.[0-9a-f]{20}\.(css|js)/);
  await verifyMedia(/styles\.[0-9a-f]{20}\.(css|js)/, /image\.png/);
}
