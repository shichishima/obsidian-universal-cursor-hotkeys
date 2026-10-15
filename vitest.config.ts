import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/unit/**/*.test.ts'],
		typecheck: {
			tsconfig: './tsconfig.test.json',
		},
	},
	resolve: {
		alias: {
			obsidian: resolve(__dirname, 'tests/unit/__mocks__/obsidian.ts'),
		},
	},
})
