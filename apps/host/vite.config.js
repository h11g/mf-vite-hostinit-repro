import { defineConfig } from 'vite';

export default defineConfig({
	base: '/host/',
	build: { target: 'esnext', outDir: '../../dist/host', emptyOutDir: true },
});
