# Shared Lua commands

The Redis Lua commands shared by every BullMQ port live in
[`golang/commands`](../../golang/commands) at the root of this repository.

They are kept there because the Go port is published straight from a git tag:
the Go module proxy serves whatever is committed under `golang/`, and
`//go:embed` cannot reference files outside its own module, follow symlinks, or
run a generation step before building. Every other port either copies the
scripts during its release (Python, Elixir, .NET, PHP, Rust) or, like this
package, inlines them at build time, so `golang/commands` is the only location
that satisfies all of them without a second copy.

This directory keeps the loader itself:

- `script-loader.ts` resolves the `--- @include "<path>"` directives.
- `index.ts` exposes the loader.

`yarn generate:raw:scripts` reads `golang/commands`, resolves the includes and
writes the result to `rawScripts/`, which the other ports copy from.
`yarn build` additionally copies the unresolved sources into `dist/*/commands`,
so the npm package ships them exactly as before.
