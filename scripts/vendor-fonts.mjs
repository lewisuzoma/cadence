#!/usr/bin/env node
/**
 * Copies the self-hosted font files out of the @fontsource-variable packages
 * into `client/src/assets/fonts/<family>/`, together with each family's
 * licence.
 *
 * Why vendor instead of importing from node_modules directly: the files then
 * live in the repository, so the build does not depend on a package layout,
 * `grep -r fonts.googleapis client/` stays empty, and the licence sits next to
 * the font it covers.
 *
 * Run after `npm install`:  npm run vendor:fonts
 */
import { copyFile, mkdir, readdir, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'client', 'src', 'assets', 'fonts');

/** Only the latin subset, normal style, variable weight axis. */
const FAMILIES = [
  {
    package: '@fontsource-variable/inter',
    dir: 'inter',
    file: 'inter-latin-wght-normal.woff2',
  },
  {
    package: '@fontsource-variable/bricolage-grotesque',
    dir: 'bricolage-grotesque',
    file: 'bricolage-grotesque-latin-wght-normal.woff2',
  },
  {
    package: '@fontsource-variable/jetbrains-mono',
    dir: 'jetbrains-mono',
    file: 'jetbrains-mono-latin-wght-normal.woff2',
  },
];

const LICENCE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'OFL.txt', 'OFL.md'];

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function findPackage(name) {
  for (const base of [join(root, 'node_modules'), join(root, 'client', 'node_modules')]) {
    const candidate = join(base, ...name.split('/'));
    if (await exists(candidate)) return candidate;
  }
  return null;
}

let copied = 0;
let missing = 0;

for (const family of FAMILIES) {
  const pkg = await findPackage(family.package);
  if (!pkg) {
    console.error(`  ! ${family.package} is not installed — run npm install first`);
    missing++;
    continue;
  }

  const outDir = join(target, family.dir);
  await mkdir(outDir, { recursive: true });

  // The woff2 files sit in the package's `files/` directory.
  const source = join(pkg, 'files', family.file);
  if (!(await exists(source))) {
    // Fall back to whatever latin variable file the package does ship, so a
    // renamed asset is a warning rather than a silent missing font.
    const available = await readdir(join(pkg, 'files')).catch(() => []);
    const guess = available.find(
      (name) => name.includes('latin') && name.includes('wght') && name.endsWith('.woff2'),
    );
    if (!guess) {
      console.error(`  ! no latin variable woff2 found in ${family.package}`);
      missing++;
      continue;
    }
    console.warn(`  ~ ${family.file} not found; using ${guess}`);
    await copyFile(join(pkg, 'files', guess), join(outDir, family.file));
  } else {
    await copyFile(source, join(outDir, family.file));
  }
  copied++;

  for (const licence of LICENCE_NAMES) {
    const from = join(pkg, licence);
    if (await exists(from)) {
      await copyFile(from, join(outDir, licence.startsWith('OFL') ? licence : 'LICENSE'));
      break;
    }
  }

  console.log(`  ✓ ${family.dir}/${family.file}`);
}

console.log(`\n${copied} font file(s) vendored into client/src/assets/fonts`);
if (missing > 0) process.exit(1);
