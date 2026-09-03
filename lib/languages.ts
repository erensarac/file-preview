/**
 * Syntax highlighting: which extensions get it, and how the grammar arrives.
 *
 * Highlighting happens in the browser, like every other client-runtime format —
 * the file must not be uploaded just to be coloured in. That makes bundle size
 * the governing constraint, so grammars are never bundled up front: each is a
 * separate dynamic import, fetched only when a file of that language is opened.
 *
 * The loaders are written out one per line rather than built from a template
 * string, because a bundler can only split what it can see statically.
 */

/** Above this, highlighting costs more than it's worth and the file renders plain. */
export const MAX_HIGHLIGHT_BYTES = 300 * 1024;

type GrammarLoader = () => Promise<unknown>;

/**
 * Grammar id → loader. Ids are Shiki's, not ours.
 */
const GRAMMARS: Record<string, GrammarLoader> = {
  astro: () => import("@shikijs/langs/astro"),
  bat: () => import("@shikijs/langs/bat"),
  c: () => import("@shikijs/langs/c"),
  clojure: () => import("@shikijs/langs/clojure"),
  cpp: () => import("@shikijs/langs/cpp"),
  csharp: () => import("@shikijs/langs/csharp"),
  css: () => import("@shikijs/langs/css"),
  dart: () => import("@shikijs/langs/dart"),
  diff: () => import("@shikijs/langs/diff"),
  docker: () => import("@shikijs/langs/docker"),
  elixir: () => import("@shikijs/langs/elixir"),
  erlang: () => import("@shikijs/langs/erlang"),
  fsharp: () => import("@shikijs/langs/fsharp"),
  go: () => import("@shikijs/langs/go"),
  graphql: () => import("@shikijs/langs/graphql"),
  haskell: () => import("@shikijs/langs/haskell"),
  hcl: () => import("@shikijs/langs/hcl"),
  html: () => import("@shikijs/langs/html"),
  ini: () => import("@shikijs/langs/ini"),
  java: () => import("@shikijs/langs/java"),
  javascript: () => import("@shikijs/langs/javascript"),
  json: () => import("@shikijs/langs/json"),
  jsonc: () => import("@shikijs/langs/jsonc"),
  jsx: () => import("@shikijs/langs/jsx"),
  kotlin: () => import("@shikijs/langs/kotlin"),
  latex: () => import("@shikijs/langs/latex"),
  less: () => import("@shikijs/langs/less"),
  lua: () => import("@shikijs/langs/lua"),
  make: () => import("@shikijs/langs/make"),
  markdown: () => import("@shikijs/langs/markdown"),
  nix: () => import("@shikijs/langs/nix"),
  "objective-c": () => import("@shikijs/langs/objective-c"),
  perl: () => import("@shikijs/langs/perl"),
  php: () => import("@shikijs/langs/php"),
  powershell: () => import("@shikijs/langs/powershell"),
  proto: () => import("@shikijs/langs/proto"),
  python: () => import("@shikijs/langs/python"),
  r: () => import("@shikijs/langs/r"),
  ruby: () => import("@shikijs/langs/ruby"),
  rust: () => import("@shikijs/langs/rust"),
  scala: () => import("@shikijs/langs/scala"),
  scss: () => import("@shikijs/langs/scss"),
  shellscript: () => import("@shikijs/langs/shellscript"),
  solidity: () => import("@shikijs/langs/solidity"),
  sql: () => import("@shikijs/langs/sql"),
  svelte: () => import("@shikijs/langs/svelte"),
  swift: () => import("@shikijs/langs/swift"),
  terraform: () => import("@shikijs/langs/terraform"),
  toml: () => import("@shikijs/langs/toml"),
  tsx: () => import("@shikijs/langs/tsx"),
  typescript: () => import("@shikijs/langs/typescript"),
  vb: () => import("@shikijs/langs/vb"),
  vue: () => import("@shikijs/langs/vue"),
  xml: () => import("@shikijs/langs/xml"),
  yaml: () => import("@shikijs/langs/yaml"),
  zig: () => import("@shikijs/langs/zig"),
};

/**
 * Extension → grammar id.
 *
 * Several extensions deliberately share a grammar: `.mjs` is JavaScript, `.htm`
 * is HTML, `.yml` is YAML. Anything absent here still opens — it just renders
 * without colour.
 */
const EXTENSION_TO_GRAMMAR: Record<string, string> = {
  astro: "astro",
  bash: "shellscript",
  bat: "bat",
  c: "c",
  cc: "cpp",
  clj: "clojure",
  cljs: "clojure",
  cmd: "bat",
  conf: "ini",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dart: "dart",
  diff: "diff",
  dockerfile: "docker",
  ejs: "html",
  env: "ini",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fs: "fsharp",
  fsx: "fsharp",
  go: "go",
  gql: "graphql",
  graphql: "graphql",
  groovy: "java",
  h: "c",
  hcl: "hcl",
  hpp: "cpp",
  hrl: "erlang",
  hs: "haskell",
  htm: "html",
  html: "html",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  json5: "jsonc",
  jsonc: "jsonc",
  jsx: "jsx",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  m: "objective-c",
  makefile: "make",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  mk: "make",
  mm: "objective-c",
  nix: "nix",
  patch: "diff",
  php: "php",
  pl: "perl",
  pm: "perl",
  proto: "proto",
  ps1: "powershell",
  py: "python",
  pyi: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "scss",
  scala: "scala",
  scss: "scss",
  sh: "shellscript",
  sol: "solidity",
  sql: "sql",
  styl: "css",
  svelte: "svelte",
  swift: "swift",
  tex: "latex",
  tf: "terraform",
  tfvars: "terraform",
  toml: "toml",
  ts: "typescript",
  tsx: "tsx",
  vb: "vb",
  vue: "vue",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zig: "zig",
  zsh: "shellscript",
};

/**
 * Names people write after a Markdown fence that aren't extensions.
 *
 * `ts` and `py` already resolve through the extension map; these are the ones
 * that don't, plus the "no highlighting wanted" spellings, which map to null so
 * a fenced block marked `text` is left alone rather than guessed at.
 */
const FENCE_ALIASES: Record<string, string | null> = {
  console: "shellscript",
  javascriptreact: "jsx",
  node: "javascript",
  objc: "objective-c",
  plaintext: "text",
  shell: "shellscript",
  text: "text",
  txt: "text",
  typescriptreact: "tsx",
  yml: "yaml",
};

/**
 * Resolves the token after a Markdown fence to a grammar.
 *
 * Fences carry language names rather than extensions, and the two overlap
 * without matching: `typescript` is a grammar id but not an extension, `ts` is
 * an extension but not a grammar id.
 */
export function grammarForFenceName(name: string): string | null {
  const token = name.trim().toLowerCase();
  if (!token) return null;

  if (token in GRAMMARS) return token;

  const alias = FENCE_ALIASES[token];
  if (alias !== undefined) {
    return alias !== null && alias in GRAMMARS ? alias : null;
  }

  return grammarForExtension(token);
}

export function grammarForExtension(extension: string): string | null {
  const grammar = EXTENSION_TO_GRAMMAR[extension.toLowerCase()];
  return grammar && grammar in GRAMMARS ? grammar : null;
}

export function loadGrammar(grammar: string): Promise<unknown> {
  const loader = GRAMMARS[grammar];
  if (!loader) throw new Error(`No grammar registered for ${grammar}`);
  return loader();
}

/** Every extension we can colour — used to keep the format registry in step. */
export const HIGHLIGHTABLE_EXTENSIONS = Object.keys(EXTENSION_TO_GRAMMAR).filter(
  (extension) => grammarForExtension(extension) !== null,
);
