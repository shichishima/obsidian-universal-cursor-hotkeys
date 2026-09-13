import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		files: ["src/main.ts", "src/settings.ts", "src/vim-support.ts", "src/table-cell-utils.ts", "src/word-segmentation.ts", "src/table-navigation.ts", "src/cjk-word-select.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
		},
	},
]);
