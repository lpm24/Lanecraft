import { defineConfig } from 'vite';
import { execSync } from 'child_process';

function gitInfo() {
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim();
    const count = execSync('git rev-list --count HEAD').toString().trim();
    return { hash, count };
  } catch {
    return { hash: 'dev', count: '0' };
  }
}

export default defineConfig(({ command }) => {
  const git = gitInfo();
  return {
    base: '/',
    define: {
      __BUILD_HASH__: JSON.stringify(git.hash),
      __BUILD_NUMBER__: JSON.stringify(git.count),
    },
    build: {
      // Content-hashed filenames for long-term caching
      rollupOptions: {
        output: {
          manualChunks: {
            // Split Firebase into its own chunk — heavy dependency most users won't need on first load
            firebase: ['firebase/app', 'firebase/auth', 'firebase/database'],
          },
        },
      },
      // Target modern browsers for smaller output
      target: 'es2020',
      // Inline small assets (< 8kb) to reduce HTTP requests
      assetsInlineLimit: 8192,
    },
  };
});
