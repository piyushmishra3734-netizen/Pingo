/**
 * Shared high-quality microphone capture for calls and voice notes.
 *
 * Voice and video calls used to request minimal audio constraints; voice notes
 * asked for even less, and MediaRecorder ran at the browser's default bitrate.
 * Video calls often *sounded* better because the same peer connection was
 * already negotiating higher media capacity - pure voice and notes were left
 * on the low path. One constraint set + explicit Opus bitrate keeps them even.
 */

/** Preferred voice encode rate. Opus speech is excellent at 64–128 kb/s. */
export const VOICE_AUDIO_BITRATE = 128_000;

/** Floor when HD audio is off - still clear speech, not a phone landline. */
export const VOICE_AUDIO_BITRATE_STANDARD = 64_000;

export interface CaptureAudioOptions {
  /** Browser AEC. Default on. */
  echoCancellation?: boolean;
  /** Browser noise suppression. Default on. */
  noiseSuppression?: boolean;
  /** Browser auto-gain. Default on - keeps quiet mics intelligible. */
  autoGainControl?: boolean;
  /**
   * Prefer 48 kHz mono speech capture.
   * Default on; matches Opus / RNNoise and avoids 44.1↔48 resampling mush.
   */
  hd?: boolean;
}

/**
 * `getUserMedia` audio constraints for speech.
 *
 * All values are `ideal` so a device that cannot hit 48 kHz still opens rather
 * than failing with `OverconstrainedError`.
 */
export function speechAudioConstraints(
  options: CaptureAudioOptions = {},
): MediaTrackConstraints {
  const hd = options.hd !== false;

  return {
    echoCancellation: options.echoCancellation !== false,
    noiseSuppression: options.noiseSuppression !== false,
    autoGainControl: options.autoGainControl !== false,
    channelCount: { ideal: 1 },
    sampleRate: { ideal: hd ? 48_000 : 44_100 },
    // Chrome / Edge: bias toward voice over music processing.
    // Unsupported keys are ignored - safe on Safari/Firefox.
    ...({
      voiceIsolation: true,
      googEchoCancellation: options.echoCancellation !== false,
      googNoiseSuppression: options.noiseSuppression !== false,
      googAutoGainControl: options.autoGainControl !== false,
      googHighpassFilter: true,
    } as MediaTrackConstraints),
  };
}

/** Best available MediaRecorder mime for speech (Opus first). */
export function preferredVoiceMimeType(): string | undefined {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => {
    try {
      return typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

/**
 * Prefer Opus on an audio sender / transceiver and lift the bitrate cap.
 *
 * Safe no-ops where the browser does not expose the APIs.
 */
export function boostAudioSender(
  connection: RTCPeerConnection,
  sender: RTCRtpSender,
  hd = true,
): void {
  const maxBitrate = hd ? VOICE_AUDIO_BITRATE : VOICE_AUDIO_BITRATE_STANDARD;

  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    for (const encoding of params.encodings) {
      encoding.maxBitrate = maxBitrate;
    }
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    // Leave browser defaults.
  }

  preferOpus(connection);
}

function preferOpus(connection: RTCPeerConnection): void {
  try {
    const caps = RTCRtpSender.getCapabilities?.('audio');
    if (!caps?.codecs?.length) return;

    const opus = caps.codecs.filter((c) => /opus/i.test(c.mimeType));
    if (opus.length === 0) return;
    const rest = caps.codecs.filter((c) => !/opus/i.test(c.mimeType));
    const preferred = [...opus, ...rest];

    for (const transceiver of connection.getTransceivers()) {
      if (transceiver.sender.track?.kind !== 'audio') continue;
      try {
        transceiver.setCodecPreferences(preferred);
      } catch {
        // setCodecPreferences can throw if called at the wrong time.
      }
    }
  } catch {
    // Capabilities API absent.
  }
}
