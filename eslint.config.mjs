import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";

export default tseslint.config(
  {
    ignores: ["drizzle/", "node_modules/", "coverage/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: {
      "import-x": importPlugin,
    },
    settings: {
      "import-x/resolver": {
        typescript: true,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "import-x/extensions": [
        "error",
        "ignorePackages",
        {
          ts: "never",
          js: "always",
        },
      ],
    },
  },
);
