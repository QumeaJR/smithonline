import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The MIT and BSD licences of the code the app is built from (SmithChart.Online itself, QuickSmith-Web,
 * scikit-rf) ask for their notices to travel with every copy. Minification may drop the source
 * headers, so the build emits `licenses.txt` next to `index.html`: the project licence followed by
 * every third-party notice. The status bar links to it.
 */
function licenses(): Plugin {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return {
    name: 'smithonline-licenses',
    generateBundle() {
      const own = readFileSync(`${root}LICENSE`, 'utf8').trim();
      const notices = readFileSync(`${root}THIRD_PARTY_NOTICES.md`, 'utf8').trim();
      this.emitFile({
        type: 'asset',
        fileName: 'licenses.txt',
        source: `SmithChart.Online\n\n${own}\n\n\n${notices}\n`,
      });
    },
  };
}

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

// base './' makes dist/index.html loadable from any path or subfolder on a static host.
export default defineConfig({
  base: './',
  // The version the usage counts carry (lib/analytics/track.ts).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss(), licenses()],
});
