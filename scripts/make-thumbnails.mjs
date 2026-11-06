#!/usr/bin/env node
/**
 * Generates the course thumbnails as SVGs into `client/public/thumbnails/`.
 *
 * The artifacts use no photography: every card carries a flat, category-
 * coloured block with two abstract shapes — a large circle bleeding off the
 * top-right corner and a rounded square at the lower left. The course editor's
 * field is literally labelled "Thumbnail colour".
 *
 * Generating them keeps the app free of any third-party image request and
 * keeps `thumbnailUrl` a real, editable column rather than a decorative
 * constant. Every colour below was sampled from the rendered artifact pages.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'client', 'public', 'thumbnails');

/**
 * Category → { base, circle, square }, sampled from docs/desktop page 3
 * (the catalog) at 1:1.
 */
const CATEGORY_COLOURS = {
  Engineering: { base: '#2F4BFF', circle: '#1E33C7', square: '#97A5FF' },
  Design: { base: '#E2551F', circle: '#C7430F', square: '#FFB98F' },
  Data: { base: '#0A7365', circle: '#065C50', square: '#7FD9C6' },
  Security: { base: '#12141C', circle: '#23262F', square: '#FFB020' },
  Product: { base: '#7B5CF0', circle: '#5E40CC', square: '#C9BBFA' },
};

const FALLBACK = CATEGORY_COLOURS.Engineering;

const COURSES = [
  { slug: 'typescript-for-production-apis', category: 'Engineering' },
  { slug: 'designing-accessible-interfaces', category: 'Design' },
  { slug: 'postgresql-from-schema-to-scale', category: 'Data' },
  { slug: 'react-state-patterns', category: 'Engineering' },
  { slug: 'nodejs-security-essentials', category: 'Security' },
  { slug: 'design-systems-in-practice', category: 'Design' },
  { slug: 'product-thinking-for-engineers', category: 'Product' },
  { slug: 'graphql-schema-design', category: 'Engineering' },
  { slug: 'testing-with-vitest-and-playwright', category: 'Engineering' },
  { slug: 'test', category: 'Engineering' },
];

/**
 * 16:9. The circle is clipped by the frame on the top-right and the rounded
 * square sits lower-left, which is the composition every catalog card uses.
 * `alt` is empty at the usage site, so the SVG carries no accessible name.
 */
function svgFor(category) {
  const { base, circle, square } = CATEGORY_COLOURS[category] ?? FALLBACK;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="presentation">
  <rect width="640" height="360" fill="${base}"/>
  <circle cx="520" cy="96" r="190" fill="${circle}"/>
  <rect x="60" y="188" width="190" height="190" rx="44" fill="${square}"/>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const course of COURSES) {
  await writeFile(join(outDir, `${course.slug}.svg`), svgFor(course.category), 'utf8');
  console.log(`  ✓ thumbnails/${course.slug}.svg  (${course.category})`);
}

/** One per category, so a newly created course has something to point at. */
for (const category of Object.keys(CATEGORY_COLOURS)) {
  const name = `category-${category.toLowerCase()}.svg`;
  await writeFile(join(outDir, name), svgFor(category), 'utf8');
  console.log(`  ✓ thumbnails/${name}`);
}

console.log(
  `\n${COURSES.length + Object.keys(CATEGORY_COLOURS).length} thumbnails written to client/public/thumbnails`,
);
