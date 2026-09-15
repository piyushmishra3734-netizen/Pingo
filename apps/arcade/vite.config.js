import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the same build runs at its own address now and
  // inside a folder of PINGO later, without rebuilding.
  base: './',
  server: {
    // Reachable from a phone on the same Wi-Fi: the budget Android is the
    // target device, not the laptop.
    host: true,
    port: 5180,
  },
  build: {
    target: 'es2020',
    // three 0.186 alone is ~516 KB minified (~130 KB gzipped), so the default
    // 500 KB warning would fire on every build and teach everyone to ignore it.
    // Set just above it: real growth past three still warns.
    chunkSizeWarningLimit: 600,
  },
});
