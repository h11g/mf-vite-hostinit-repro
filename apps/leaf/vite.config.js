import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';

export default defineConfig({
	base: '/leaf/',
	build: { target: 'esnext', outDir: '../../dist/leaf', emptyOutDir: true },
	plugins: [
		federation({
			name: 'leaf',
			filename: 'remoteEntry.js',
			dts: false,
			exposes: { './x': './src/x.js' },
			shared: { 'shared-lib': { singleton: true } },
		}),
	],
});
