# Repro: `hostInit` calls `init()` with no share scope and wipes the host's scope

`@module-federation/vite@1.20.9` (bundles `@module-federation/runtime@2.9.0`).

## What happens

A container that has **both `exposes` and `remotes`** — an app that is a remote of
someone else *and* a host of its own sub-remotes — silently stops sharing
singletons when it is loaded by an outer host.

In `build` mode the plugin makes every generated `loadRemote` module statically
import a self-executing `hostInit` chunk (`lib/index.js:5341`):

```js
const importLine = command === "build"
  ? `... import { hostInitPromise as __mfHostInitPromise } from "<hostAutoInit>";`
  : `<devRuntimeBootstrap>`;                     // dev: globalThis[key].initPromise handshake
const remoteLoadRuntimePromise = command === "build" ? "__mfHostInitPromise" : "initPromise";
```

`hostInit` runs on import and calls the container's own entry with no arguments
(`generateHostAutoInitCode`, `lib/index.js:4974`):

```js
const remoteEntry = await import(<remoteEntry>);
const runtime = await remoteEntry.init();     // no shareScope, no initScope
```

The generated `init(shareScope = {}, initScope = [])` therefore runs a second
time with an empty scope and calls `initShareScopeMap("default", {})`, replacing
the scope the outer host passed in a moment earlier. The container then resolves
its shared deps from its own scope and loads a second copy of every singleton.

The container's own re-entrancy guard cannot catch this, because it keys off
`initScope`, and `hostInit` does not pass one:

```js
var G = je[Pe]; if (G || (G = je[Pe] = {from: k}), a.indexOf(G) >= 0) return; a.push(G)
```

## Layout

| app | role | `exposes` | `remotes` |
| --- | --- | --- | --- |
| `apps/host` | outer host — **plain `@module-federation/runtime`**, no vite plugin | – | `mid` |
| `apps/mid` | remote **and** host — the failing combination | `./probe` | `leaf` |
| `apps/leaf` | plain remote — built-in control | `./x` | – |

`packages/shared-lib` is a singleton whose module body generates one random id
per evaluation, so two ids on the page means two copies.

`apps/host` deliberately does **not** use `@module-federation/vite`. A
vite-plugin host masks the bug: its private `globalThis.__mf_module_cache__`
hands the already-loaded singleton back to the nested container even though the
share scope was replaced. Any other federation host (webpack, rspack, or a
hand-written `init()` like the one here) has no such cache and gets duplicates.

## Run

```bash
npm install
npm run build            # leaf + mid + host
npm run serve            # http://localhost:5599
open http://localhost:5599/host/index.html
```

## Result

```
host shared-lib : shared-lib#32772o
mid  shared-lib : shared-lib#a0uj9g
FAIL duplicate instance
instances       : host, mid, leaf
scope host : shared-lib@1.0.0 from=host
scope mid  : shared-lib@1.0.0 from=mid      <-- own copy
scope leaf : shared-lib@1.0.0 from=host     <-- control: adopted the host's
mid scope === host scope : false
```

Expected: `mid` resolves `shared-lib` from the host, exactly like `leaf` does.

`leaf` is the built-in control. Same plugin, same version, same page — it has no
`remotes` of its own, so nothing imports `hostInit`, and it shares correctly.

## Two more builds that confirm the cause

```bash
npm run build:mid:no-remotes  && npm run build:host   # drop mid's sub-remote
npm run build:mid:guard       && npm run build:host   # keep it, guard the init
npm run build:mid:loaded-first && npm run build:host  # keep it, shareStrategy: 'loaded-first'
```

| build of `mid` | `hostInit` in the `remoteEntry` graph | `mid` scope === host scope | `shared-lib` copies |
| --- | --- | --- | --- |
| default (`version-first`) | yes | **false** | **2** |
| `NO_REMOTES=1` | no (only in `mid`'s own `index.html`) | true | 1 |
| `MF_GUARD=1` | yes | true | 1 |
| `MF_LOADED_FIRST=1` | yes | **false** | 1 |

The last row matters for triage: with `shareStrategy: 'loaded-first'` the share
scope is **still** replaced, but the duplicate disappears, because `hostInit`
gates its whole share-preload loop on `shouldPreloadShares =
shareStrategy !== "loaded-first"` (`lib/index.js:4961`). Nothing then forces the
container to load its own copies, so the modules resolved during the *first*
`init()` survive in `globalThis.__mf_module_cache__`. So `loaded-first`
containers carry the same broken scope silently and only break later, when
something does materialize a share from it.

`MF_GUARD=1` enables a ~10-line `transform` in `apps/mid/vite.config.js` that
wraps the generated entry's `init` so a scope-less call cannot clobber an
initialization that already happened:

```js
let __mfInitPromise;
const __mfGuardedInit = (...a) => {
	const hasScope = a[0] && Object.keys(a[0]).length > 0;
	if (!hasScope && __mfInitPromise) return __mfInitPromise;
	__mfInitPromise = init(...a);
	return __mfInitPromise;
};
```

That is a userland patch, not a proposed fix — the entry is a generated virtual
module, so patching it means string-matching plugin output.

## Notes

- `hostInitInjectLocation` does not help. It only chooses where the standalone
  bootstrap is injected (`html` vs `entry`); the `import` inside the generated
  `loadRemote` module is unconditional in `build` mode.
- `isRemoteOnlyContainer()` requires `remotes` to be empty, so a container that
  is both a host and a remote can never take that path.
- `dev` mode is fine: it resolves the runtime through
  `globalThis[key].initPromise`, which either `init()` call can settle, so the
  outer host's scope survives.
