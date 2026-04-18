// Server-only runtime config derived from env.
//
// NSFW_ENABLED is a startup kill switch for the entire adult-content
// surface: adult-tagged series in the library, NSFW-only scrapers
// (omegascans, madaradex, toonily, oppai, manhwa18, hentai20), the
// NSFW tab in the library, the "Move to NSFW" button, the manage-page
// toggle, and the `?nsfw=1` branch of every API route.
//
// Default: disabled. The flag must be explicitly set to `1` to opt in.
// Any other value ("", "0", "true", "false", unset) disables NSFW.
//
// This module is server-only (it reads process.env directly). Client
// code receives the resolved value as a prop passed through the root
// layout — see `NsfwProvider` wiring in `src/app/layout.tsx`.

export function isNsfwEnabled(): boolean {
  return process.env.NSFW_ENABLED === "1";
}
