import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteAssets } from './site-assets.mjs';

// Export the same allowlisted resources as preview; the browser demo and third-party notices travel together.
const output = fileURLToPath(new URL('../.build/site/', import.meta.url));
const buildRoot = fileURLToPath(new URL('../.build/', import.meta.url));
// Clean only this generated export so retired screenshots cannot remain in a later public bundle.
if (resolve(output) !== resolve(buildRoot, 'site')) throw new Error('Invalid export directory');
await rm(output, { recursive: true, force: true });
let count = 0;
for (const [route, source] of siteAssets) {
  if (route === '/') continue;
  const destination = resolve(output, route.slice(1));
  if (!destination.startsWith(resolve(output) + sep)) throw new Error('Invalid public asset path');
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  count += 1;
}
console.log(`Exported ${count} public website assets to ${output}`);
