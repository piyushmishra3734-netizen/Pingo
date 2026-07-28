import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { initNativeShell } from './features/native/shell.js';

import { App } from './App.js';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * The OS behaviours, once the app is mounted.
 *
 * After render rather than before, because the splash is hidden in here and
 * hiding it earlier would reveal an empty root. On the web every call inside
 * is skipped, so this costs a function call and nothing else.
 *
 * The back handler returns false for now: nothing has claimed the gesture, so
 * history and then backgrounding are the correct fallbacks. Screens that open
 * a sheet will claim it here rather than each binding their own listener.
 */
void initNativeShell(() => false);
