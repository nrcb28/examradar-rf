import { cp, lstat, mkdir, readdir, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== path.resolve(root) || path.basename(output) !== 'dist') throw new Error('Unsafe build output');
async function checkTree(directory) {
  if ((await lstat(directory)).isSymbolicLink()) throw new Error('Build inputs cannot contain symlinks');
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if ((await lstat(file)).isSymbolicLink()) throw new Error('Build inputs cannot contain symlinks');
    if (entry.isDirectory()) await checkTree(file);
  }
}
for (const directory of ['public', 'src/core', 'src/ui']) await checkTree(path.join(root, directory));
if ((await lstat(path.join(root, 'src/index.js'))).isSymbolicLink()) throw new Error('Build inputs cannot contain symlinks');
// Only this checkout's generated dist directory may be replaced.
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'src'), { recursive: true });
for (const asset of ['index.html', 'app.js', 'styles.css', 'favicon.svg']) {
  await copyFile(path.join(root, 'public', asset), path.join(output, asset));
}
for (const directory of ['core', 'ui']) {
  await cp(path.join(root, 'src', directory), path.join(output, 'src', directory), {
    recursive: true, filter: source => !path.basename(source).startsWith('.') && (path.extname(source) === '.js' || path.extname(source) === ''),
  });
}
await copyFile(path.join(root, 'src/index.js'), path.join(output, 'src/index.js'));
console.log('Built static simulator in dist/ (public assets and browser modules only).');
