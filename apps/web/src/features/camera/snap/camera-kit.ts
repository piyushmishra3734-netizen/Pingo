/**
 * Snap Camera Kit - the AR Lenses in PINGO's camera.
 *
 * The API token is a client token: Snap issues it to be shipped inside the app,
 * the same way the Supabase anon key is, and it identifies the app rather than
 * granting anything. An environment value overrides the default so the
 * Production token can be switched in once Snap approves the app (the Staging
 * one works for testing and loads the lens group below).
 *
 * App ID / bundle registered with Snap: chat.pingo.app.
 */
export const CAMERA_KIT_TOKEN: string =
  import.meta.env.VITE_CAMERA_KIT_TOKEN ??
  'eyJhbGciOiJIUzI1NiIsImtpZCI6IkNhbnZhc1MyU0hNQUNQcm9kIiwidHlwIjoiSldUIn0.eyJhdWQiOiJjYW52YXMtY2FudmFzYXBpIiwiaXNzIjoiY2FudmFzLXMyc3Rva2VuIiwibmJmIjoxNzkwNDIzODUxLCJzdWIiOiJiNzU4NzZmNy04YTIxLTQ4YzAtYWI2Ny01OGY0OTE0MDhhYmZ-U1RBR0lOR35mNGJmOWZhOC1jZDk2LTQyZWEtODY3MC0wMGNiMDVmZDJhZWQifQ.sdqvQtj4Hl19BdOUFkP0dsiffotWxIUJ-kRcto8txJA';

/**
 * Which lenses the camera offers: one or more Lens Group ids from the Snap
 * portal, comma separated in VITE_CAMERA_KIT_GROUP. Every group is loaded and
 * shown together, so adding lenses is adding a group, not a code change.
 */
export const CAMERA_KIT_GROUPS: string[] = (import.meta.env.VITE_CAMERA_KIT_GROUP ?? 'dd8e26ac-ae4a-40ca-b602-bba3fd74c07b')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
