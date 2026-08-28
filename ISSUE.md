# A container with both `exposes` and `remotes` loses the host's share scope in build mode (`hostInit` calls `init()` with no arguments)

## Environment

- `@module-federation/vite` 1.20.9 (bundles `@module-federation/runtime` 2.9.0)
- vite 7.3.6, node 25.9.0
- `command === "build"` only; `dev` is unaffected

## Summary

A container that declares **both `exposes` and `remotes`** — an app that is a
remote of an outer host *and* a host of its own sub-remotes — silently stops
sharing singletons with the outer host after `vite build`. It ends up with its
own share scope and loads a second copy of every shared dependency (in our real
app: a second React, which crashes the embedded remote with
`Cannot read properties of null (reading 'useMemo')` because the second React's
`ReactCurrentDispatcher.current` is `null`).

## Reproduction

https://github.com/h11g/mf-vite-hostinit-repro — `npm install && npm run build
&& npm run serve`, then open `http://localhost:5599/host/index.html`.

| app | role | `exposes` | `remotes` |
| --- | --- | --- | --- |
| `apps/host` | outer host, plain `@module-federation/runtime` (no vite plugin) | – | `mid` |
| `apps/mid` | remote **and** host — the failing combination | `./probe` | `leaf` |
| `apps/leaf` | plain remote — built-in control | `./x` | – |

`packages/shared-lib` is a `singleton: true` package whose module body generates
a random id per evaluation, so two ids on the page means two copies.

### Actual

```
host shared-lib : shared-lib#32772o
mid  shared-lib : shared-lib#a0uj9g
FAIL duplicate instance
scope host : shared-lib@1.0.0 from=host
scope mid  : shared-lib@1.0.0 from=mid      <-- its own copy
scope leaf : shared-lib@1.0.0 from=host     <-- control, adopted the host's
mid scope === host scope : false
```

### Expected

`mid` resolves `shared-lib` from the host, exactly like `leaf` does on the same
page with the same plugin and version. `leaf` differs only in having no
`remotes` of its own.

## Cause

In build mode every generated `loadRemote` module statically imports a
self-executing `hostInit` chunk — `generateRemotes`, `lib/index.js:5321`:

```js
const importLine = command === "build"
  ? `... import { hostInitPromise as __mfHostInitPromise } from "<hostAutoInit>";`
  : `<devRuntimeBootstrap>`;                     // dev: globalThis[key].initPromise handshake
const remoteLoadRuntimePromise = command === "build" ? "__mfHostInitPromise" : "initPromise";
```

`hostInit` has a top-level side effect and calls the container's own entry with
no arguments — `generateHostAutoInitCode`, `lib/index.js:4974`:

```js
const remoteEntry = await import(<remoteEntry>);
const runtime = await remoteEntry.init();     // no shareScope, no initScope
```

So the entry's `init(shareScope = {}, initScope = [])` runs a second time with
an empty scope and calls `initShareScopeMap("default", {})`, replacing the scope
the outer host handed over moments earlier via `loadRemote` → `initContainer`.
Instrumenting the exported `init` on our production build shows exactly two
calls:

```
#1 args=3 scope=<host scope, 29 pkgs>   stack: host loadRemote -> Module.get -> Module.init
#2 args=0 scope=undefined               stack: <container>/assets/hostInit-*.js
```

The container's own re-entrancy guard cannot catch call #2, because it keys off
`initScope` and `hostInit` passes none — `a` falls back to a fresh `[]`:

```js
var G = je[Pe]; if (G || (G = je[Pe] = {from: k}), a.indexOf(G) >= 0) return; a.push(G)
```

`dev` mode does not have the problem: it resolves the runtime through
`globalThis[key].initPromise`, which either `init()` call can settle, so the
outer host's scope survives. The two branches of the same codegen disagree.

## Why it is easy to miss

If the outer host is *also* a `@module-federation/vite` build, the bug is
masked: the plugin's private `globalThis.__mf_module_cache__` hands the
already-loaded singleton back to the nested container even though its share
scope was replaced. Hosts that are not vite-plugin builds — webpack, rspack, or
a hand-written `init()` as in this repro — have no such cache and get
duplicates. `apps/host` here is deliberately a plain `@module-federation/runtime`
host for that reason.

## No opt-out today

- `hostInitInjectLocation` only chooses where the standalone bootstrap is
  injected (`html` vs `entry`); the `import` inside the generated `loadRemote`
  module is unconditional in build mode.
- `isRemoteOnlyContainer()` requires `remotes` to be empty, so a container that
  is both a host and a remote can never take that path.

## Possible fixes

1. Use the `initPromise` handshake in build mode too, as dev already does,
   instead of hard-binding `__mfHostInitPromise`.
2. Have `hostInit` pass an `initScope`, so the entry's existing re-entrancy
   guard fires on the second call.
3. Make the generated `init` ignore a scope-less call once the container has
   already been initialized.

## Current workaround (userland)

Confirmed to fix it in this repro (`MF_GUARD=1`, see
`apps/mid/vite.config.js`) and in our production app: a `transform` that wraps
the generated entry's `init` so a scope-less call cannot clobber an
initialization that already happened.

```js
let __mfInitPromise;
const __mfGuardedInit = (...a) => {
	const hasScope = a[0] && Object.keys(a[0]).length > 0;
	if (!hasScope && __mfInitPromise) return __mfInitPromise;
	__mfInitPromise = init(...a);
	return __mfInitPromise;
};
```

It string-matches generated virtual-module output, so it is not something we
want to keep.
