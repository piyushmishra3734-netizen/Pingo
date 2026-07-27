import { AuthProvider, ChatProvider, ProfileProvider } from '@pingo/core';
import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';

import { AppShell } from './app/AppShell.js';
import { IdentityFlow } from './features/auth/IdentityFlow.js';
import { RequireAuth, RequireGuest } from './features/auth/guards.js';
import { markOnboarded } from './features/auth/onboarded.js';
import { CallOverlay } from './features/calls/CallOverlay.js';
import { CallProvider } from './features/calls/CallProvider.js';
import { NotificationProvider } from './features/notifications/NotificationContext.js';
import { ProfileSetupFlow } from './features/profile/ProfileSetupFlow.js';
import { RequireProfile } from './features/profile/guards.js';
import { SettingsProvider } from './features/settings/SettingsContext.js';
import { StickerProvider } from './features/stickers/StickerContext.js';
import { StoryProvider } from './features/stories/StoryContext.js';
import {
  SupabaseAuthService,
  SupabaseCallService,
  SupabaseChatService,
  SupabaseProfileService,
  SupabaseStoryService,
} from './lib/supabase/index.js';
import { CallsScreen } from './screens/CallsScreen.js';
import { CameraScreen } from './screens/CameraScreen.js';
import { ChatsScreen } from './screens/ChatsScreen.js';
import { CommunitiesScreen } from './screens/CommunitiesScreen.js';
import { FollowRequestsScreen } from './screens/FollowRequestsScreen.js';
import { NewChatScreen } from './screens/NewChatScreen.js';
import { NotificationsScreen as NotificationsFeedScreen } from './screens/NotificationsScreen.js';
import { EditProfileScreen } from './screens/EditProfileScreen.js';
import { ProfileScreen } from './screens/ProfileScreen.js';
import { SettingsScreen } from './screens/SettingsScreen.js';
import { AccountScreen } from './screens/settings/AccountScreen.js';
import { AdvancedScreen } from './screens/settings/AdvancedScreen.js';
import { AppearanceScreen } from './screens/settings/AppearanceScreen.js';
import { CallsSettingsScreen } from './screens/settings/CallsSettingsScreen.js';
import { CameraSettingsScreen } from './screens/settings/CameraSettingsScreen.js';
import { ChatsSettingsScreen } from './screens/settings/ChatsSettingsScreen.js';
import { HelpScreen } from './screens/settings/HelpScreen.js';
import { LanguageScreen } from './screens/settings/LanguageScreen.js';
import { NotificationsScreen } from './screens/settings/NotificationsScreen.js';
import { PrivacyScreen } from './screens/settings/PrivacyScreen.js';
import { StorageScreen } from './screens/settings/StorageScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';
import { SplashScreen } from './screens/SplashScreen.js';
import { CreatePasswordScreen } from './screens/auth/CreatePasswordScreen.js';
import { GoogleConnectingScreen } from './screens/auth/GoogleConnectingScreen.js';
import { LoginEmailScreen } from './screens/auth/LoginEmailScreen.js';
import { LoginMethodScreen } from './screens/auth/LoginMethodScreen.js';
import { LoginPasswordScreen } from './screens/auth/LoginPasswordScreen.js';
import { LoginPhoneScreen } from './screens/auth/LoginPhoneScreen.js';
import { SignUpEmailScreen } from './screens/auth/SignUpEmailScreen.js';
import { SignUpMethodScreen } from './screens/auth/SignUpMethodScreen.js';
import { SignUpPhoneScreen } from './screens/auth/SignUpPhoneScreen.js';
import { FindingPeopleScreen } from './screens/setup/FindingPeopleScreen.js';
import { NameScreen } from './screens/setup/NameScreen.js';
import { PermissionsScreen } from './screens/setup/PermissionsScreen.js';
import { PhotoScreen } from './screens/setup/PhotoScreen.js';
import { UsernameScreen } from './screens/setup/UsernameScreen.js';

/**
 * Route map and composition root.
 *
 * This is the one file that names concrete implementations. `SupabaseAuthService`
 * is constructed here and injected into `AuthProvider`; every screen below
 * depends on `@pingo/core`'s `AuthService` interface and could not name Supabase
 * if it wanted to. `ChatService` keeps the same arrangement, still on its mock —
 * identity is real, message data is not, and the two boundaries move
 * independently by design.
 *
 * ## The route groups
 *
 * | Group | Guard | Screens |
 * | --- | --- | --- |
 * | Pre-session | `RequireGuest` | Welcome, Log In, both identifier steps, both password steps |
 * | Google | none — see below | The § 5.1 interstitial |
 * | The product | `RequireAuth` | Everything inside `AppShell` |
 *
 * Sign-up and log-in are both `IdentityFlow` layouts: an identifier step, then a
 * password step that reads what the first one collected. Both are guarded now
 * that no step creates a session before its last action — the mid-flow
 * authenticated state that once forced sign-up to stay open is gone with the
 * verification step.
 *
 * `/auth/google` is deliberately outside both guards. It is the *return* URL for
 * the OAuth redirect, so it is entered signed out and left signed in; under
 * `RequireGuest` the arriving session would bounce it to Home before it could
 * record which method was used, and under `RequireAuth` it could never be
 * reached to start the redirect at all.
 *
 * `/chats` and `/chats/:conversationId` still resolve to one screen: on a phone
 * it shows the list or the thread, on a desktop both. One component, because
 * they are one experience.
 */
export function App() {
  /*
   * Constructed once, lazily. A module-scope `new SupabaseAuthService()` would
   * run `getSupabaseClient()` at import time and take the whole bundle down on a
   * missing environment variable — the failure mode `client.ts` was written to
   * avoid.
   */
  const [services] = useState(() => {
    try {
      return {
        auth: new SupabaseAuthService(),
        profile: new SupabaseProfileService(),
        chat: new SupabaseChatService(),
        story: new SupabaseStoryService(),
        call: new SupabaseCallService(),
        error: undefined,
      };
    } catch (error) {
      return {
        auth: undefined,
        profile: undefined,
        chat: undefined,
        story: undefined,
        call: undefined,
        error: error as Error,
      };
    }
  });

  if (
    !services.auth ||
    !services.profile ||
    !services.chat ||
    !services.story ||
    !services.call
  ) {
    return <ConfigurationError error={services.error} />;
  }

  return (
    /*
      Outermost, and outside auth on purpose: theme and accent apply to the
      splash and the sign-in screens too, which a signed-out user sees first.
    */
    <SettingsProvider>
    <AuthProvider
      service={services.auth}
      /*
       * Records that this device has an account, which is what lets the splash
       * send a signed-out returning user to Log In rather than back through
       * Welcome (docs/01 § 3).
       */
      onAuthenticated={markOnboarded}
    >
      {/*
        Inside auth, because a profile only exists for a signed-in user; outside
        the router, because the guards need to read it while deciding routes.
      */}
      <ProfileProvider service={services.profile}>
        {/*
          Real conversations and messages, over Realtime. The mock is gone from
          the running app — `MockChatService` stays in `@pingo/core` for the
          styleguide and for tests, which is what it was always for.
        */}
        <StickerProvider>
        <StoryProvider service={services.story}>
        <ChatProvider service={services.chat}>
        {/*
          Calls sit above the router, not inside it: a call is not a place you
          navigate to, and answering one must not lose the screen you were on.
        */}
        <NotificationProvider>
        <CallProvider service={services.call}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<SplashScreen />} />

            {/* Pre-session. A signed-in visitor is sent to Home. */}
            <Route element={<RequireGuest />}>
              {/*
                The branding board's onboarding screen, unchanged. Its two
                buttons are the only way into auth: Get Started opens the
                sign-up method rows, Log In opens the returning-user ones.
              */}
              <Route path="/welcome" element={<OnboardingScreen />} />

              <Route path="/signup" element={<SignUpMethodScreen />} />
              <Route path="/login" element={<LoginMethodScreen />} />

              <Route
                path="/signup"
                element={
                  <IdentityFlow
                    entryPaths={['/signup/email', '/signup/phone']}
                    fallback="/signup"
                  />
                }
              >
                <Route path="email" element={<SignUpEmailScreen />} />
                <Route path="phone" element={<SignUpPhoneScreen />} />
                <Route path="password" element={<CreatePasswordScreen />} />
              </Route>

              <Route
                path="/login"
                element={
                  <IdentityFlow entryPaths={['/login/email', '/login/phone']} fallback="/login" />
                }
              >
                <Route path="email" element={<LoginEmailScreen />} />
                <Route path="phone" element={<LoginPhoneScreen />} />
                <Route path="password" element={<LoginPasswordScreen />} />
              </Route>
            </Route>

            {/* Both legs of the Google redirect. See the note above. */}
            <Route path="/auth/google" element={<GoogleConnectingScreen />} />

            {/*
              Profile setup. Signed in, but deliberately *not* behind
              `RequireProfile` — these are the screens that create the profile,
              so requiring one would be a loop.
            */}
            <Route element={<RequireAuth />}>
              <Route path="/setup" element={<ProfileSetupFlow />}>
                <Route path="name" element={<NameScreen />} />
                <Route path="username" element={<UsernameScreen />} />
                <Route path="photo" element={<PhotoScreen />} />
                <Route path="permissions" element={<PermissionsScreen />} />
                <Route path="people" element={<FindingPeopleScreen />} />
              </Route>
            </Route>

            {/* The product. Needs a session *and* a finished profile. */}
            <Route element={<RequireAuth />}>
              <Route element={<RequireProfile />}>
                <Route element={<AppShell />}>
                  <Route path="/chats" element={<ChatsScreen />} />
                  {/*
                    Before the dynamic segment. React Router ranks static paths
                    higher anyway, but relying on that leaves "new" one careless
                    reorder away from being read as a conversation id.
                  */}
                  <Route path="/chats/new" element={<NewChatScreen />} />
                  <Route path="/chats/:conversationId" element={<ChatsScreen />} />
                  <Route path="/calls" element={<CallsScreen />} />
                  <Route path="/camera" element={<CameraScreen />} />
                  <Route path="/communities" element={<CommunitiesScreen />} />
                  <Route path="/notifications" element={<NotificationsFeedScreen />} />
                  <Route path="/requests" element={<FollowRequestsScreen />} />
                  <Route path="/profile" element={<ProfileScreen />} />
                  {/* Before `:handle`, or "edit" would be read as a username. */}
                  <Route path="/profile/edit" element={<EditProfileScreen />} />
                  {/* Accepts a handle or a user id — see `ProfileService.find`. */}
                  <Route path="/profile/:handle" element={<ProfileScreen />} />
                  <Route path="/settings" element={<SettingsScreen />} />
                  <Route path="/settings/account" element={<AccountScreen />} />
                  <Route path="/settings/appearance" element={<AppearanceScreen />} />
                  <Route path="/settings/notifications" element={<NotificationsScreen />} />
                  <Route path="/settings/privacy" element={<PrivacyScreen />} />
                  <Route path="/settings/chats" element={<ChatsSettingsScreen />} />
                  <Route path="/settings/camera-snaps" element={<CameraSettingsScreen />} />
                  <Route path="/settings/calls" element={<CallsSettingsScreen />} />
                  <Route path="/settings/storage" element={<StorageScreen />} />
                  <Route path="/settings/language" element={<LanguageScreen />} />
                  <Route path="/settings/advanced" element={<AdvancedScreen />} />
                  <Route path="/settings/help" element={<HelpScreen />} />
                </Route>
              </Route>
            </Route>

            {/*
              Unknown paths fall back to the product's home, not an error page.
              `RequireAuth` then sends a signed-out visitor somewhere they can
              actually act.
            */}
            <Route path="*" element={<Navigate to="/chats" replace />} />
          </Routes>
        </BrowserRouter>
        <CallOverlay />
        </CallProvider>
        </NotificationProvider>
        </ChatProvider>
        </StoryProvider>
        </StickerProvider>
      </ProfileProvider>
    </AuthProvider>
    </SettingsProvider>
  );
}

/**
 * Shown when the Supabase client cannot be built at all.
 *
 * An operator's problem, not a user's — a missing `.env` — so it says exactly
 * what is wrong instead of rendering a blank page and leaving the message in a
 * console nobody has open.
 */
function ConfigurationError({ error }: { error?: Error }) {
  return (
    <div className="grid h-full place-items-center bg-brand-wash p-6">
      <div className="max-w-md rounded-lg bg-surface p-6 shadow-sm">
        <h1 className="text-h2 text-ink">PINGO can't start</h1>
        <p className="mt-3 whitespace-pre-line text-caption text-text-secondary">
          {error?.message ?? 'The Supabase client could not be created.'}
        </p>
      </div>
    </div>
  );
}
