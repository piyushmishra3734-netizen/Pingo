import { AuthProvider, ChatProvider, ProfileProvider } from '@pingo/core';
import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { BrowserRouter } from 'react-router-dom';

import { AppShell } from './app/AppShell.js';
import { IdentityFlow } from './features/auth/IdentityFlow.js';
import { RequireAuth, RequireGuest } from './features/auth/guards.js';
import { markOnboarded } from './features/auth/onboarded.js';
import { CallBoundary } from './features/calls/CallBoundary.js';
import { CallOverlay } from './features/calls/CallOverlay.js';
import { ConfirmProvider } from './components/ConfirmProvider.js';
import { CallProvider } from './features/calls/CallProvider.js';
import { MessageToastProvider } from './features/notifications/MessageToastProvider.js';
import { NotificationProvider } from './features/notifications/NotificationContext.js';
import { ProfileSetupFlow } from './features/profile/ProfileSetupFlow.js';
import { RequireProfile } from './features/profile/guards.js';
import { NotificationPrefsSync } from './features/settings/NotificationPrefsSync.js';
import { RouteBoundary } from './components/RouteBoundary.js';
import { UpdateNotice } from './features/updates/UpdateNotice.js';
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
/**
 * A screen fetched when somebody goes to it, rather than before they arrive.
 *
 * Every screen in this app was imported statically, which put all fifty-five of
 * them - settings, camera, stories, backup, the QR reader, the legal pages - in
 * one 2 MB chunk that had to arrive before the chat list could be drawn. On a
 * fast connection that is invisible. On 2G it is minutes of staring at nothing
 * to read a message, and it happens again after every deploy.
 *
 * Four screens stay eager because they are the whole of what a returning user
 * sees: the splash, the chat list and thread (one screen), and the two first-run
 * ones. Everything else costs a request the first time it is opened, and the
 * service worker precaches the lot in the background anyway - so the trade is
 * "first paint now, the rest while you read" rather than "wait for all of it".
 *
 * `React.lazy` wants a default export and this codebase uses named ones, which
 * is the whole of what this wrapper does.
 */
function lazyScreen<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const CallsScreen = lazyScreen(() => import('./screens/CallsScreen.js'), 'CallsScreen');
const CameraScreen = lazyScreen(() => import('./screens/CameraScreen.js'), 'CameraScreen');
import { ChatsScreen } from './screens/ChatsScreen.js';
const CommunitiesScreen = lazyScreen(() => import('./screens/CommunitiesScreen.js'), 'CommunitiesScreen');
const FollowRequestsScreen = lazyScreen(() => import('./screens/FollowRequestsScreen.js'), 'FollowRequestsScreen');
import { LiveProfile } from './features/profile/LiveProfile.js';
const DownloadScreen = lazyScreen(() => import('./screens/DownloadScreen.js'), 'DownloadScreen');
const ReferralLandingScreen = lazyScreen(
  () => import('./screens/ReferralLandingScreen.js'),
  'ReferralLandingScreen',
);
const PrivacyPolicyScreen = lazyScreen(() => import('./screens/PrivacyPolicyScreen.js'), 'PrivacyPolicyScreen');
const TermsScreen = lazyScreen(() => import('./screens/TermsScreen.js'), 'TermsScreen');
const NewChatScreen = lazyScreen(() => import('./screens/NewChatScreen.js'), 'NewChatScreen');
const ShareScreen = lazyScreen(() => import('./screens/ShareScreen.js'), 'ShareScreen');
const NewGroupScreen = lazyScreen(() => import('./screens/NewGroupScreen.js'), 'NewGroupScreen');
const JoinGroupScreen = lazyScreen(() => import('./screens/JoinGroupScreen.js'), 'JoinGroupScreen');
const NotificationsFeedScreen = lazyScreen(() => import('./screens/NotificationsScreen.js'), 'NotificationsScreen');
const EditProfileScreen = lazyScreen(() => import('./screens/EditProfileScreen.js'), 'EditProfileScreen');
const JourneyScreen = lazyScreen(() => import('./screens/JourneyScreen.js'), 'JourneyScreen');
const AchievementsScreen = lazyScreen(
  () => import('./screens/AchievementsScreen.js'),
  'AchievementsScreen',
);
const MythicMissionScreen = lazyScreen(
  () => import('./screens/MythicMissionScreen.js'),
  'MythicMissionScreen',
);
const ProfileScreen = lazyScreen(() => import('./screens/ProfileScreen.js'), 'ProfileScreen');
const StoryArchiveScreen = lazyScreen(() => import('./screens/StoryArchiveScreen.js'), 'StoryArchiveScreen');
const SettingsScreen = lazyScreen(() => import('./screens/SettingsScreen.js'), 'SettingsScreen');
const AccountScreen = lazyScreen(() => import('./screens/settings/AccountScreen.js'), 'AccountScreen');
const ChangePasswordScreen = lazyScreen(() => import('./screens/settings/ChangePasswordScreen.js'), 'ChangePasswordScreen');
const AdvancedScreen = lazyScreen(() => import('./screens/settings/AdvancedScreen.js'), 'AdvancedScreen');
const AppearanceScreen = lazyScreen(() => import('./screens/settings/AppearanceScreen.js'), 'AppearanceScreen');
const CallsSettingsScreen = lazyScreen(() => import('./screens/settings/CallsSettingsScreen.js'), 'CallsSettingsScreen');
const MutedStoriesScreen = lazyScreen(() => import('./screens/settings/MutedStoriesScreen.js'), 'MutedStoriesScreen');
const CameraSettingsScreen = lazyScreen(() => import('./screens/settings/CameraSettingsScreen.js'), 'CameraSettingsScreen');
const ChatsSettingsScreen = lazyScreen(() => import('./screens/settings/ChatsSettingsScreen.js'), 'ChatsSettingsScreen');
const WallpaperScreen = lazyScreen(() => import('./screens/settings/WallpaperScreen.js'), 'WallpaperScreen');
const HelpScreen = lazyScreen(() => import('./screens/settings/HelpScreen.js'), 'HelpScreen');
const LanguageScreen = lazyScreen(() => import('./screens/settings/LanguageScreen.js'), 'LanguageScreen');
const NotificationsScreen = lazyScreen(() => import('./screens/settings/NotificationsScreen.js'), 'NotificationsScreen');
const PrivacyScreen = lazyScreen(() => import('./screens/settings/PrivacyScreen.js'), 'PrivacyScreen');
const PushDebugScreen = lazyScreen(() => import('./screens/settings/PushDebugScreen.js'), 'PushDebugScreen');
const SecureBackupScreen = lazyScreen(() => import('./screens/settings/SecureBackupScreen.js'), 'SecureBackupScreen');
const DevicesScreen = lazyScreen(() => import('./screens/settings/DevicesScreen.js'), 'DevicesScreen');
const StorageScreen = lazyScreen(() => import('./screens/settings/StorageScreen.js'), 'StorageScreen');
import { IntroSlidesScreen } from './screens/IntroSlidesScreen.js';
import { OnboardingScreen } from './screens/OnboardingScreen.js';
import { SplashScreen } from './screens/SplashScreen.js';
const ControllingScreen = lazyScreen(() => import('./screens/settings/ControllingScreen.js'), 'ControllingScreen');
const ToastFeelLab = lazyScreen(() => import('./screens/dev/ToastFeelLab.js'), 'ToastFeelLab');
const CreatePasswordScreen = lazyScreen(() => import('./screens/auth/CreatePasswordScreen.js'), 'CreatePasswordScreen');
const GoogleConnectingScreen = lazyScreen(() => import('./screens/auth/GoogleConnectingScreen.js'), 'GoogleConnectingScreen');
const LoginEmailScreen = lazyScreen(() => import('./screens/auth/LoginEmailScreen.js'), 'LoginEmailScreen');
const LoginMethodScreen = lazyScreen(() => import('./screens/auth/LoginMethodScreen.js'), 'LoginMethodScreen');
const LoginPasswordScreen = lazyScreen(() => import('./screens/auth/LoginPasswordScreen.js'), 'LoginPasswordScreen');
const LoginPhoneScreen = lazyScreen(() => import('./screens/auth/LoginPhoneScreen.js'), 'LoginPhoneScreen');
const LoginUsernameScreen = lazyScreen(() => import('./screens/auth/LoginUsernameScreen.js'), 'LoginUsernameScreen');
const SignUpEmailScreen = lazyScreen(() => import('./screens/auth/SignUpEmailScreen.js'), 'SignUpEmailScreen');
const SignUpMethodScreen = lazyScreen(() => import('./screens/auth/SignUpMethodScreen.js'), 'SignUpMethodScreen');
const SignUpPhoneScreen = lazyScreen(() => import('./screens/auth/SignUpPhoneScreen.js'), 'SignUpPhoneScreen');
const NameScreen = lazyScreen(() => import('./screens/setup/NameScreen.js'), 'NameScreen');
const BackupScreen = lazyScreen(() => import('./screens/setup/BackupScreen.js'), 'BackupScreen');
const PermissionsScreen = lazyScreen(() => import('./screens/setup/PermissionsScreen.js'), 'PermissionsScreen');
const PhotoScreen = lazyScreen(() => import('./screens/setup/PhotoScreen.js'), 'PhotoScreen');
const UsernameScreen = lazyScreen(() => import('./screens/setup/UsernameScreen.js'), 'UsernameScreen');

/**
 * Route map and composition root.
 *
 * This is the one file that names concrete implementations. `SupabaseAuthService`
 * is constructed here and injected into `AuthProvider`; every screen below
 * depends on `@pingo/core`'s `AuthService` interface and could not name Supabase
 * if it wanted to. `ChatService` keeps the same arrangement, still on its mock  - 
 * identity is real, message data is not, and the two boundaries move
 * independently by design.
 *
 * ## The route groups
 *
 * | Group | Guard | Screens |
 * | --- | --- | --- |
 * | Pre-session | `RequireGuest` | Welcome, Log In, both identifier steps, both password steps |
 * | Google | none - see below | The § 5.1 interstitial |
 * | The product | `RequireAuth` | Everything inside `AppShell` |
 *
 * Sign-up and log-in are both `IdentityFlow` layouts: an identifier step, then a
 * password step that reads what the first one collected. Both are guarded now
 * that no step creates a session before its last action - the mid-flow
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
   * missing environment variable - the failure mode `client.ts` was written to
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

  /*
   * Read-only diagnostics, reachable from the console.
   *
   * `deltaReport` and `rowStoreReport` were both written to be inspected on a
   * real device with real data rather than argued about - that is what their
   * comments say. Neither had a caller and neither was exposed, so in a built
   * bundle there was no way to read either, and milestone 3 could not be
   * diagnosed from the deployed app at all (see docs/performance-baseline.md
   * § 8). Both only hand back counters the service already keeps: nothing is
   * read from storage, nothing is sent, and nothing changes.
   */
  /*
   * The platform's long-press menu, refused on media only.
   *
   * Holding a photo or a video on a phone opens the browser's own sheet - Open
   * image, Copy, Download, Search, Share - which is what somebody gets for
   * resting a thumb on a picture to look at it.
   *
   * Cancelling `contextmenu` is the half that works on Android; the CSS half
   * (`-webkit-touch-callout`) is the one iOS listens to, and neither covers the
   * other. One listener at the root rather than a handler on every `<img>`,
   * because the per-component version reached two of them and missed the photo
   * bubble, the viewer, the story and the link card.
   *
   * Scoped to media so a long press on text still offers copy, and so the
   * desktop right-click menu - reload, back, inspect - is untouched everywhere
   * except on a picture.
   */
  useEffect(() => {
    const refuse = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'IMG' || tag === 'VIDEO') event.preventDefault();
    };
    document.addEventListener('contextmenu', refuse);
    return () => document.removeEventListener('contextmenu', refuse);
  }, []);

  useEffect(() => {
    const chat = services.chat;
    if (!chat) return undefined;

    const target = window as unknown as { __pingo?: Record<string, () => unknown> };
    target.__pingo = {
      delta: () => chat.deltaReport(),
      rowStore: () => chat.rowStoreReport(),
      /*
       * The archive builder against this device's real IndexedDB. Everything
       * else about it is verified with an injected source and sink, which says
       * nothing about the two functions that actually touch storage and the
       * device key. Reads, writes back what it read, reports numbers.
       */
      /* Stage 2: capability measurement only. Creates no credential. */
      passkeySupport: async () => {
        const { measurePasskeySupport } = await import('./lib/backup/passkey-support.js');
        return measurePasskeySupport();
      },
      archiveSelfTest: async (chunkSize?: number) => {
        const [{ archiveSelfTest }] = await Promise.all([import('./lib/backup/self-test.js')]);
        const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
          'deriveKey',
          'deriveBits',
        ]);
        const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
        const base64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
        return archiveSelfTest(base64, pair.privateKey, chunkSize);
      },
    };
    return () => {
      delete target.__pingo;
    };
  }, [services.chat]);

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
    {/*
      Outside auth, because logging out is one of the things it asks about - a
      confirmation that unmounts with the session could not survive its own
      question.
    */}
    <ConfirmProvider>
    {/*
      Outside auth, because being behind on builds has nothing to do with being
      signed in - and somebody logged out on an old APK is exactly who needs
      telling.
    */}
    <UpdateNotice />
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
      <NotificationPrefsSync />
      <ProfileProvider service={services.profile}>
        {/*
          Real conversations and messages, over Realtime. The mock is gone from
          the running app - `MockChatService` stays in `@pingo/core` for the
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
          {/*
            Inside the router (needs location + navigate) and CallProvider
            (suppresses banners during a live call). Portal host for floating
            message toasts when a new message arrives outside the open thread.
          */}
          <MessageToastProvider>
          {/*
            Nothing is drawn while a lazy screen is being fetched.

            The screens that matter are eager, so this only ever covers a
            navigation somebody just asked for - and on a cached load the chunk
            is already on disk and this never renders at all. A spinner here
            would flash on every settings tap on a fast connection, which is a
            worse thing to have than a blank beat on a slow one.
          */}
          {/*
            Outside Suspense, because what it is here to catch is the lazy
            import itself failing - and an unhandled one takes the whole
            application down to a white page with no way back. See RouteBoundary
            for what that looked like and why refreshing did not clear it.
          */}
          <RouteBoundary>
          <Suspense fallback={null}>
          <Routes>
            <Route path="/" element={<SplashScreen />} />

            {/*
              Pre-auth intro carousel. Outside RequireGuest so @piuxxh can
              Preview while signed in (`?replay=1`). Anonymous users land here
              from splash; first-time cannot Skip (handled in the screen).
            */}
            <Route path="/intro" element={<IntroSlidesScreen />} />

            {/*
              Public, and outside every guard.

              These were nested under `RequireGuest`, which exists to bounce a
              *signed-in* visitor to Home - so tapping "Learn more" from the
              install banner sent the user straight back to the chat list, and
              the Terms and Privacy links in the footer did the same thing.

              None of the three is pre-session content. A download page is for
              people with an account as much as without one, and terms nobody
              signed in can open are terms nobody can re-read after agreeing to
              them.
            */}
            <Route path="/download" element={<DownloadScreen />} />
            <Route path="/terms" element={<TermsScreen />} />
            <Route path="/privacy" element={<PrivacyPolicyScreen />} />
            {/*
              A referral link, which is for somebody who has no account yet -
              so it is public for the same reason the download page is. It
              records the code and hands straight over to the splash, which
              already knows where a visitor belongs. See `ReferralLandingScreen`.
            */}
            <Route path="/r/:code" element={<ReferralLandingScreen />} />
            {/*
              Dev-only pressure test for floating message banners. Unauthenticated
              on purpose so the lab opens without a session. Not linked from UI.
            */}
            {import.meta.env.DEV && (
              <Route path="/dev/toast-lab" element={<ToastFeelLab />} />
            )}

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
                  <IdentityFlow
                    entryPaths={['/login/email', '/login/phone', '/login/username']}
                    fallback="/login"
                  />
                }
              >
                <Route path="email" element={<LoginEmailScreen />} />
                <Route path="phone" element={<LoginPhoneScreen />} />
                <Route path="username" element={<LoginUsernameScreen />} />
                <Route path="password" element={<LoginPasswordScreen />} />
              </Route>
            </Route>

            {/* Both legs of the Google redirect. See the note above. */}
            <Route path="/auth/google" element={<GoogleConnectingScreen />} />

            {/*
              Profile setup. Signed in, but deliberately *not* behind
              `RequireProfile` - these are the screens that create the profile,
              so requiring one would be a loop.
            */}
            <Route element={<RequireAuth />}>
              <Route path="/setup" element={<ProfileSetupFlow />}>
                <Route path="name" element={<NameScreen />} />
                <Route path="username" element={<UsernameScreen />} />
                <Route path="photo" element={<PhotoScreen />} />
                <Route path="permissions" element={<PermissionsScreen />} />
                <Route path="backup" element={<BackupScreen />} />
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
                  <Route path="/share" element={<ShareScreen />} />
                  <Route path="/chats/new-group" element={<NewGroupScreen />} />
                  <Route path="/join/:code" element={<JoinGroupScreen />} />
                  <Route path="/chats/:conversationId" element={<ChatsScreen />} />
                  <Route path="/calls" element={<CallsScreen />} />
                  <Route path="/camera" element={<CameraScreen />} />
                  <Route path="/communities" element={<CommunitiesScreen />} />
                  <Route path="/notifications" element={<NotificationsFeedScreen />} />
                  <Route path="/requests" element={<FollowRequestsScreen />} />
                  <Route path="/profile" element={<ProfileScreen />} />
                  {/* Before `:handle`, or "edit" would be read as a username. */}
                  <Route path="/profile/edit" element={<EditProfileScreen />} />
                  <Route path="/profile/journey" element={<JourneyScreen />} />
                  <Route path="/profile/mission" element={<MythicMissionScreen />} />
                  <Route path="/profile/achievements" element={<AchievementsScreen />} />
                  {/* Accepts a handle or a user id - see `ProfileService.find`. */}
                  <Route path="/profile/:handle" element={<ProfileScreen />} />
                  {/* Private, and owner-only by the read policy rather than by this route. */}
                  <Route path="/stories/archive" element={<StoryArchiveScreen />} />
                  <Route path="/settings" element={<SettingsScreen />} />
                  <Route path="/settings/account" element={<AccountScreen />} />
                  <Route path="/settings/password" element={<ChangePasswordScreen />} />
                  <Route path="/settings/appearance" element={<AppearanceScreen />} />
                  <Route path="/settings/notifications" element={<NotificationsScreen />} />
                  <Route path="/settings/notifications/debug" element={<PushDebugScreen />} />
                  <Route path="/settings/privacy" element={<PrivacyScreen />} />
                  <Route path="/settings/chats" element={<ChatsSettingsScreen />} />
                  <Route path="/settings/wallpaper" element={<WallpaperScreen />} />
                  <Route path="/settings/camera-snaps" element={<CameraSettingsScreen />} />
                  <Route path="/settings/calls" element={<CallsSettingsScreen />} />
                  <Route path="/settings/muted-stories" element={<MutedStoriesScreen />} />
                  <Route path="/settings/devices" element={<DevicesScreen />} />
                  <Route path="/settings/storage" element={<StorageScreen />} />
                  <Route path="/settings/secure-backup" element={<SecureBackupScreen />} />
                  <Route path="/settings/language" element={<LanguageScreen />} />
                  <Route path="/settings/advanced" element={<AdvancedScreen />} />
                  <Route path="/settings/controlling" element={<ControllingScreen />} />
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
          </Suspense>
          </RouteBoundary>
          </MessageToastProvider>
        </BrowserRouter>
        {/*
          Wrapped, because a render error here used to unmount the whole app.
          The page stays alive when React gives up, so the call's socket stays
          connected too - a blank screen on one side and a participant who
          looks fine on every other. See `CallBoundary`.
        */}
        <CallBoundary>
          <CallOverlay />
        </CallBoundary>
        {/* Renders nothing. Keeps this session’s own profile live everywhere. */}
        <LiveProfile />
        </CallProvider>
        </NotificationProvider>
        </ChatProvider>
        </StoryProvider>
        </StickerProvider>
      </ProfileProvider>
    </AuthProvider>
    </ConfirmProvider>
    </SettingsProvider>
  );
}

/**
 * Shown when the Supabase client cannot be built at all.
 *
 * An operator's problem, not a user's - a missing `.env` - so it says exactly
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
