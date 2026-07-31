import { Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Advanced.
 *
 * **Debug Logs is real** - it turns console logging on and off for this device,
 * which is exactly what it says. The other three are flags with no features
 * behind them yet; they are stored so that when an experiment ships it has a
 * switch already, rather than needing one bolted on.
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

      <Group
        title="Flags"
        note="Nothing reads these yet. They exist so an experiment can ship with its switch already in place."
      >
        <ToggleRow
          label="Developer Mode"
          checked={a.developerMode}
          onChange={(developerMode) => update('advanced', { developerMode })}
        />
        <ToggleRow
          label="Experimental Features"
          checked={a.experimentalFeatures}
          onChange={(experimentalFeatures) => update('advanced', { experimentalFeatures })}
        />
        <ToggleRow
          label="Beta Features"
          checked={a.betaFeatures}
          onChange={(betaFeatures) => update('advanced', { betaFeatures })}
        />
      </Group>

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
