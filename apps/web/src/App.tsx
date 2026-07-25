import { ChatProvider } from '@pingo/core';
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';

import { AppShell } from './app/AppShell.js';
import { CallsScreen } from './screens/CallsScreen.js';
import { ChatsScreen } from './screens/ChatsScreen.js';
import { CommunitiesScreen } from './screens/CommunitiesScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { SplashScreen } from './screens/SplashScreen.js';

/**
 * Route map.
 *
 * Splash and onboarding sit outside `AppShell` because they are pre-session
 * screens: no dock, no navigation, nothing to switch between. Everything after
 * sign-in shares the shell, which is what makes the dock feel like a permanent
 * part of the product rather than a component each screen remembers to render.
 *
 * `/chats` and `/chats/:conversationId` deliberately resolve to the same screen.
 * On a phone that screen shows either the list or the thread; on a desktop it
 * shows both at once. One component, because they are one experience — which is
 * also what keeps deep links working identically on both.
 */
export function App() {
  return (
    <ChatProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<SplashScreen />} />
          <Route path="/welcome" element={<OnboardingScreen />} />

          <Route element={<AppShell />}>
            <Route path="/chats" element={<ChatsScreen />} />
            <Route path="/chats/:conversationId" element={<ChatsScreen />} />
            <Route path="/calls" element={<CallsScreen />} />
            <Route path="/communities" element={<CommunitiesScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="/profile/:handle" element={<ProfileScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Route>

          {/* Unknown paths fall back to the product's home, not an error page. */}
          <Route path="*" element={<Navigate to="/chats" replace />} />
        </Routes>
      </BrowserRouter>
    </ChatProvider>
  );
}
