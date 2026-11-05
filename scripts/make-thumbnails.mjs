#!/usr/bin/env node
/**
 * Generates the course thumbnails as SVGs into `client/public/thumbnails/`.
 *
 * The design artifacts do not use photography: the course editor's field is
 * literally labelled "Thumbnail colour", and the catalog cards show flat
 * colour blocks with the course's category. Generating them keeps the app free
 * of any third-party image request, and keeps `thumbnailUrl` a real, editable
 * column rather than a decorative constant.
 *
 * Palette values are the design tokens from docs/design-notes.md.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'client', 'public', 'thumbnails');

/** Category → [from, to] gradient, built from the token palette. */
const CATEGORY_COLOURS = {
  Engineering: ['#2F4BFF', '#1E33C7'], // Cobalt → Cobalt deep
  Design: ['#7A3BFF', '#2F4BFF'],
  Data: ['#0E8A5C', '#0B6B48'], // Green
  Security: ['#C2261B', '#8E1C14'], // Red
  Product: ['#B85C00', '#8A4500'], // Amber
};

const COURSES = [
  { slug: 'typescript-for-production-apis', title: 'TypeScript for Production APIs', category: 'Engineering' },
  { slug: 'designing-accessible-interfaces', title: 'Designing Accessible Interfaces', category: 'Design' },
  { slug: 'postgresql-from-schema-to-scale', title: 'PostgreSQL from Schema to Scale', category: 'Data' },
  { slug: 'react-state-patterns', title: 'React State Patterns', category: 'Engineering' },
  { slug: 'nodejs-security-essentials', title: 'Node.js Security Essentials', category: 'Security' },
  { slug: 'design-systems-in-practice', title: 'Design Systems in Practice', category: 'Design' },
  { slug: 'product-thinking-for-engineers', title: 'Product Thinking for Engineers', category: 'Product' },
  { slug: 'graphql-schema-design', title: 'GraphQL Schema Design', category: 'Engineering' },
  { slug: 'test', title: 'Test Course', category: 'Engineering' },
];

const escape = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Initials, the way the design's avatar and thumbnail blocks show them. */
const initialsOf = (title) =>
  title
    .replace(/[^A-Za-z0-9 .]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => /^[A-Z]/.test(word))
    .slice(0, 3)
    .map((word) => word[0])
    .join('');

/**
 * 16:9 at the catalog card's rendered size. A faint diagonal rule and a dot
 * grid give the block some texture without an image asset.
 */
function svgFor({ title, category }) {
  const [from, to] = CATEGORY_COLOURS[category] ?? CATEGORY_COLOURS.Engineering;
  const initials = initialsOf(title) || 'C';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360" width="640" height="360" role="img" aria-label="${escape(title)}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${from}"/>
      <stop offset="100%" stop-color="${to}"/>
    </linearGradient>
    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.5" fill="#ffffff" fill-opacity="0.14"/>
    </pattern>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <rect width="640" height="360" fill="url(#dots)"/>
  <path d="M400 360 L640 120 L640 360 Z" fill="#ffffff" fill-opacity="0.06"/>
  <path d="M-40 300 L300 -40" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
  <text x="48" y="206" font-family="Bricolage Grotesque, Inter, Segoe UI, Arial, sans-serif"
        font-size="104" font-weight="800" fill="#ffffff" fill-opacity="0.96"
        letter-spacing="-4">${escape(initials)}</text>
  <text x="50" y="256" font-family="Inter, Segoe UI, Arial, sans-serif"
        font-size="20" font-weight="600" fill="#ffffff" fill-opacity="0.80"
        letter-spacing="1.2">${escape(category.toUpperCase())}</text>
</svg>
`;
}

await mkdir(outDir, { recursive: true });
for (const course of COURSES) {
  await writeFile(join(outDir, `${course.slug}.svg`), svgFor(course), 'utf8');
  console.log(`  ✓ thumbnails/${course.slug}.svg`);
}
console.log(`\n${COURSES.length} thumbnails written to client/public/thumbnails`);
