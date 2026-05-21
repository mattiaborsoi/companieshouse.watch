// Ambient declarations for side-effect imports.
// Required since TypeScript 6 — it now requires explicit type declarations
// for non-code imports like CSS, even when they're side-effect-only.
// Next.js handles the actual CSS loading via its built-in PostCSS pipeline.
declare module "*.css";
