import { Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Advanced.
 *
 * **Debug Logs is real** - it turns console logging on and off for this device,
 * which is exactly what it says. It is now the only switch on the page: the
 * three flags below it had no features behind them and were removed rather than
 * left on screen with a note saying so.
 *
 * Reset is here rather than on the index: it is the most destructive thing in
 * Settings that is not account deletion, and it belongs behind one more tap.
 */
export function AdvancedScreen() {
  const { preferences, update, reset } = usePreferences();
  const a = preferences.advanced;

  return (
    <SettingsPage title="Advanced">
      <Group title="Diagnostics">
        <ToggleRow
          label="Debug Logs"
          description="Prints detailed logs to the browser console."
          checked={a.debugLogs}
          onChange={(debugLogs) => {
            update('advanced', { debugLogs });
            // Applied immediately - the point of a debug switch is the next thing
            // you do, not the next time you launch.
            (window as unknown as { __pingoDebug?: boolean }).__pingoDebug = debugLogs;
          }}
        />
      </Group>

      {/*
        Developer Mode, Experimental Features and Beta Features are not rendered.

        The group admitted in its own note that nothing read them, which is an
        honest label on a dishonest control: three switches that a person can
        turn on, that stay on, and that do nothing whatsoever. Keeping a switch
        warm for a future experiment is a developer's convenience, and it does
        not justify shipping three of them to everybody who opens this page.

        The preferences themselves are untouched, so the day an experiment needs
        one the switch is four lines away - which was the actual argument for
        having them, and it survives them not being on screen.
      */}

      <Group
        title="Reset"
        note="Puts every setting back to its default. Your account, messages and photos are not touched."
      >
        <InfoRow
          label="Reset all settings"
          onClick={() => reset()}
          destructive
        />
      </Group>
    </SettingsPage>
  );
}
