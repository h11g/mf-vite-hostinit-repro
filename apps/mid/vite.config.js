import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { federation } from '@module-federation/vite';

// NO_REMOTES=1 -> drop the sub-remote, so no `hostInit` gets imported.
// MF_GUARD=1   -> keep the sub-remote, but stop a scope-less init() from
//                 clobbering an initialization that already happened.
const withRemotes = process.env.NO_REMOTES !== '1';

const initGuard = {
	name: 'mf-init-guard',
	enforce: 'post',
	apply: 'build',
	transform(code, id) {
		if (!id.includes('mf-REMOTE_ENTRY_ID')) return null;
		const re = /export\s*\{\s*init\s*,\s*getExposes\s+as\s+get\s*\}/;
		if (!re.test(code)) return null;
		return {
			code: code.replace(
				re,
				`let __mfInitPromise;
const __mfGuardedInit = (...a) => {
	const hasScope = a[0] && Object.keys(a[0]).length > 0;
	if (!hasScope && __mfInitPromise) return __mfInitPromise;
	__mfInitPromise = init(...a);
	return __mfInitPromise;
};
export { __mfGuardedInit as init, getExposes as get }`
			),
			map: null,
		};
	},
};

export default defineConfig({
	base: '/mid/',
	resolve: withRemotes
		? {}
		: {
				alias: {
					'leaf/x': fileURLToPath(new URL('./src/leaf-stub.js', import.meta.url)),
				},
			},
	build: { target: 'esnext', outDir: '../../dist/mid', emptyOutDir: true },
	plugins: [
		federation({
			name: 'mid',
			filename: 'remoteEntry.js',
			dts: false,
			exposes: { './probe': './src/probe.js' },
			remotes: withRemotes
				? {
						leaf: {
							type: 'module',
							name: 'leaf',
							entry: 'http://localhost:5599/leaf/remoteEntry.js',
						},
					}
				: {},
			shared: { 'shared-lib': { singleton: true } },
		}),
		...(process.env.MF_GUARD === '1' ? [initGuard] : []),
	],
});
