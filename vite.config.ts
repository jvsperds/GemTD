/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { execSync } from 'node:child_process';
import pkg from './package.json' with { type: 'json' };

// Docker builds have no .git, so CI passes GIT_SHA in.
let sha = process.env.GIT_SHA?.slice(0, 7);
try {
  sha ||= execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  sha = 'unknown';
}

export default defineConfig({
  base: './',
  define: { __BUILD__: JSON.stringify(`v${pkg.version} · ${sha}`) },
  plugins: [viteSingleFile()],
  test: { include: ['tests/**/*.test.ts'] },
});
