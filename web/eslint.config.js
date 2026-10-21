import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist", ".wrangler", ".vitest", "node_modules", "worker-configuration.d.ts"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["src/client/**/*.{ts,tsx}", "tests/client/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // UI data access goes only through SWR hooks + the Axios instance (see CLAUDE.md).
    files: ["src/client/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "Use the SWR hooks in src/client/hooks and the Axios instance." },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "fetch",
          message: "Use the SWR hooks in src/client/hooks and the Axios instance.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/worker/*", "**/worker"],
              message: "The client bundle must never import from src/worker.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["tests/worker/**/*.ts", "src/worker/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);
