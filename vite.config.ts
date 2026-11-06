import { defineConfig } from 'vite';
// Self-contained static build: relative base, no CDN, no module-preload polyfill.
export default defineConfig({
	base: './',
	server: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
	build: { target: 'es2022', outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 8000, modulePreload: { polyfill: false } },
});
