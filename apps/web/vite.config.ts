import { fileURLToPath } from 'node:url';

import basicSsl from '@vitejs/plugin-basic-ssl';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * HTTPS in development is not optional here.
 *
 * The camera, the microphone and WebRTC all require a *secure context*. The
 * browser grants that to `localhost` as a special case, which is why everything
 * works on this machine over plain HTTP — but a phone reaching
 * `http://192.168.x.x:5173` is not localhost, so `navigator.mediaDevices` is
 * simply `undefined` there. Not a permission prompt, not an error: the API does
 * not exist. Serving over HTTPS is the only thing that fixes it.
 *
 * The certificate is self-signed, so the phone will warn once and needs
 * "Advanced → Proceed". That is expected and safe on your own network; it is a
 * warning about identity, not about encryption.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Fails loudly instead of silently moving to another port, which matters
    // when a second dev server would look like the app "not reloading".
    strictPort: true,
    /*
     * Bound to every interface so a phone on the same Wi-Fi can reach it.
     * Without this Vite listens on 127.0.0.1 only and the LAN address refuses
     * the connection — which reads as "the server is down" from the phone.
     */
    host: true,
  },
});
