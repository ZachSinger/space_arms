import js from "@eslint/js";
import globals from "globals";

// Folders moved or written during the rebuild are held to errors; legacy folders only warn
// until their code moves (see documentation/RebuildPlan.md, Phase 0).
const STRICT_FOLDERS = [
  "js/core/**",
  "js/state/**",
  "js/systems/**",
  "js/world/**",
  "js/actors/**",
  "js/input/**",
  "js/interaction/**",
  "js/ui/**",
  "js/modules/**",
  "js/debug/**",
];

const sharedRules = {
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
};

export default [
  { ignores: ["dist/**", "release/**", "node_modules/**", "img/**", "assets/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, Phaser: "readonly" },
    },
    rules: sharedRules,
  },
  {
    files: ["js/logic/**", "js/scenes/**", "scripts/**", "tests/**", "*.js"],
    rules: Object.fromEntries(
      Object.keys({ ...js.configs.recommended.rules, ...sharedRules }).map((rule) => [rule, "warn"]),
    ),
  },
  { files: STRICT_FOLDERS, rules: sharedRules },
  { files: ["preload.cjs"], languageOptions: { sourceType: "commonjs" } },
];
