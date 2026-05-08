/**
 * Static asset module declarations.
 *
 * Why this file exists: esbuild's `dataurl` loader and Vite's default asset
 * handling both turn `import url from './foo.png'` into a string at build
 * time. TypeScript needs an ambient module declaration to type the import.
 *
 * Inlining keeps binary assets out of the release zip — the official
 * Obsidian Community Plugins installer and BRAT both download only
 * main.js / manifest.json / styles.css and ignore everything else.
 */

declare module '*.png' {
	const src: string;
	export default src;
}
