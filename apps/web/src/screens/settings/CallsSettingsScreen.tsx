import { useRef, useState } from 'react';

import { Group, InfoRow, SettingsPage, ToggleRow } from '../../features/settings/controls.js';
import { usePreferences } from '../../features/settings/SettingsContext.js';

/**
 * Calls.
 *
 * PINGO has no calling yet, so every switch here is a stored preference waiting
 * for a call engine to read it. The page says that once rather than eight
 * times.
 *
 * **Microphone Test is the exception, and it is completely real** - it opens
 * the mic and shows a live level meter. It needs no calling stack, it answers
 * the only question anyone actually has on this screen ("is my mic working?"),
 * and it is the one control here that would be a lie to fake.
 */
export function CallsSettingsScreen() {
  const { preferences, update } = usePreferences();
  const c = preferences.calls;

  const [level, setLevel] = useState<number | undefined>();
  const [micError, setMicError] = useState<string | undefined>();
  const stopRef = useRef<(() => void) | undefined>(undefined);

  const toggleMicTest = async () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = undefined;
      setLevel(undefined);
      return;
    }

    setMicError(undefined);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      let raf = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        // Peak deviation from silence (128), normalised.
        let peak = 0;
        for (const sample of data) peak = Math.max(peak, Math.abs(sample - 128));
        setLevel(Math.min(1, peak / 90));
        raf = requestAnimationFrame(tick);
      };
      tick();

      stopRef.current = () => {
        cancelAnimationFrame(raf);
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      };
    } catch {
      setMicError('No microphone, or permission was refused.');
    }
  };

  return (
    <SettingsPage title="Calls">
      <Group title="Audio">
        <ToggleRow
          label="Noise Cancellation"
          checked={c.noiseCancellation}
          onChange={(noiseCancellation) => update('calls', { noiseCancellation })}
        />
        <ToggleRow
          label="Echo Cancellation"
          checked={c.echoCancellation}
          onChange={(echoCancellation) => update('calls', { echoCancellation })}
        />
        <ToggleRow
          label="HD Audio"
          description="Better sound, more data."
          checked={c.hdAudio}
          onChange={(hdAudio) => update('calls', { hdAudio })}
        />
      </Group>

      <Group title="Video">
        <ToggleRow
          label="HD Video"
          checked={c.hdVideo}
          onChange={(hdVideo) => update('calls', { hdVideo })}
        />
        <ToggleRow
          label="Camera Default"
          description="Start video calls with your camera already on."
          checked={c.cameraOnByDefault}
          onChange={(cameraOnByDefault) => update('calls', { cameraOnByDefault })}
        />
      </Group>

      <Group title="Microphone" note={micError}>
        <InfoRow
          label="Microphone Test"
          value={stopRef.current ? 'Stop' : 'Start'}
          onClick={() => void toggleMicTest()}
        />
        {level !== undefined && (
          <div className="px-3 py-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
              <div
                className="h-full rounded-full bg-brand-gradient transition-[width] duration-instant"
                style={{ width: `${Math.round(level * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-caption text-text-secondary">
              Say something - the bar should move.
            </p>
          </div>
        )}
      </Group>

      <p className="px-1 pb-4 text-caption text-text-tertiary">
        Calling is not built yet, so these are saved and wait for it. The microphone test is
        live and uses your real microphone.
      </p>
    </SettingsPage>
  );
}
