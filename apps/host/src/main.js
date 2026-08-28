import { init, loadRemote } from '@module-federation/runtime';
import * as sharedLib from 'shared-lib';

const lines = [];
const log = (s) => {
	lines.push(s);
	document.getElementById('out').textContent = lines.join('\n');
	console.log(s);
};

// Plain MF runtime host: register `shared-lib` as a singleton, then load the
// `mid` container. The runtime hands `mid` this host's share scope object.
init({
	name: 'host',
	remotes: [
		{
			name: 'mid',
			entry: 'http://localhost:5599/mid/remoteEntry.js',
			type: 'module',
		},
	],
	shared: {
		'shared-lib': {
			version: '1.0.0',
			lib: () => sharedLib,
			scope: 'default',
			shareConfig: { singleton: true, requiredVersion: false },
		},
	},
	shareStrategy: 'version-first',
});

const mod = await loadRemote('mid/probe');
const midId = mod.probe();

log('host shared-lib : ' + sharedLib.instanceId);
log('mid  shared-lib : ' + midId);
log(midId === sharedLib.instanceId ? 'PASS single instance' : 'FAIL duplicate instance');

const F = globalThis.__FEDERATION__;
const inst = F.__INSTANCES__ || [];
const byName = (n) => inst.find((i) => i.options && i.options.name === n);
const h = byName('host');
const m = byName('mid');
log('instances       : ' + inst.map((i) => i.options.name).join(', '));
for (const [k, v] of Object.entries(F.__SHARE__ || {})) {
	const d = (v || {}).default || {};
	const entries = Object.entries(d).flatMap(([pkg, vers]) =>
		Object.entries(vers).map(([ver, e]) => pkg + '@' + ver + ' from=' + e.from)
	);
	log('scope ' + k + ' : ' + (entries.join(', ') || '(empty)'));
}
log('mid scope === host scope : ' + !!(h && m && h.shareScopeMap.default === m.shareScopeMap.default));
