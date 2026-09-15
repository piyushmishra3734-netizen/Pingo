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
    /*
     * Set just above what the main chunk measures, so real growth still warns.
     *
     * three 0.186 alone is ~516 KB minified. The Kenney model then added ~61
     * KB to the main chunk even with GLTFLoader split out: three is one module,
     * so the parts of it only the loader uses still live where three does.
     * Our own lobby code is ~25 KB of the ~602. Games and the network layer
     * are separate chunks and do not count here.
     */
    chunkSizeWarningLimit: 640,
  },
});
