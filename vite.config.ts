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
    base: process.env.CAP_BUILD
      ? '/'
      : (command === 'serve' ? '/' : '/SpawnWars/'),
    define: {
      __BUILD_HASH__: JSON.stringify(git.hash),
      __BUILD_NUMBER__: JSON.stringify(git.count),
    },
  };
});
