import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import {
  startRealtimeCall,
  type CallActivity,
  type CallTurn,
  type RealtimeCallController,
  type RealtimeCallError,
  type RealtimeCallState,
  type RealtimeEndReason,
  type RealtimeLevels,
} from './realtime-call.js';

/** Before `start` and after `end`, the hook's own state. */
export type RealtimeHookState = 'idle' | RealtimeCallState;

export interface UseRealtimeCall {
  state: RealtimeHookState;
  error: RealtimeCallError | undefined;
  /** Why it ended, once `state` is `ended`. */
  endReason: RealtimeEndReason | undefined;
  activity: CallActivity;
  /** Their voice is being heard right now. */
  userSpeaking: boolean;
  muted: boolean;
  /** Turns with text, oldest first; a turn's `id` stays the same as its text grows. */
  turns: CallTurn[];
  /** Updated ~20 times a second. For a per-frame animation read `levelsRef` instead, which does not re-render. */
  levels: RealtimeLevels;
  levelsRef: MutableRefObject<RealtimeLevels>;
  start: (conversationId: string, voice?: string) => void;
  end: () => Promise<void>;
  toggleMute: () => void;
}

/**
 * A PINGO AI voice call as React state. One call at a time: `start` while a
 * call is running ends that one first. Unmounting hangs up (and saves).
 *
 * `trackLevels: false` keeps `levels` at zero and skips the 20-per-second
 * re-render; `levelsRef` still updates.
 */
export function useRealtimeCall(options: { trackLevels?: boolean } = {}): UseRealtimeCall {
  const trackLevels = options.trackLevels !== false;
  const [state, setState] = useState<RealtimeHookState>('idle');
  const [error, setError] = useState<RealtimeCallError | undefined>();
  const [endReason, setEndReason] = useState<RealtimeEndReason | undefined>();
  const [activity, setActivity] = useState<CallActivity>('listening');
  const [userSpeaking, setUserSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<CallTurn[]>([]);
  const [levels, setLevels] = useState<RealtimeLevels>({ me: 0, ai: 0 });
  const levelsRef = useRef<RealtimeLevels>({ me: 0, ai: 0 });
  const callRef = useRef<RealtimeCallController | null>(null);

  const start = useCallback(
    (conversationId: string, voice?: string) => {
      void callRef.current?.end();
      setState('connecting');
      setError(undefined);
      setEndReason(undefined);
      setActivity('listening');
      setUserSpeaking(false);
      setMuted(false);
      setTurns([]);
      const call = startRealtimeCall({
        conversationId,
        ...(voice ? { voice } : {}),
        onState: (next, detail) => {
          if (callRef.current !== call) return;
          setState(next);
          if (detail?.error) setError(detail.error);
          if (detail?.reason) setEndReason(detail.reason);
        },
        onActivity: (a, speaking) => {
          if (callRef.current !== call) return;
          setActivity(a);
          setUserSpeaking(speaking);
        },
        onTranscript: (turn) => {
          if (callRef.current !== call) return;
          setTurns((list) => {
            const at = list.findIndex((t) => t.id === turn.id);
            if (at === -1) return [...list, turn];
            const next = list.slice();
            next[at] = turn;
            return next;
          });
        },
        onLevel: (l) => {
          levelsRef.current = l;
          if (trackLevels && callRef.current === call) setLevels(l);
        },
      });
      callRef.current = call;
    },
    [trackLevels],
  );

  const end = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;
    await call.end();
  }, []);

  const toggleMute = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    call.setMuted(!call.muted);
    setMuted(call.muted);
  }, []);

  // Leaving the screen hangs up; the transcript is still saved.
  useEffect(
    () => () => {
      void callRef.current?.end();
      callRef.current = null;
    },
    [],
  );

  return { state, error, endReason, activity, userSpeaking, muted, turns, levels, levelsRef, start, end, toggleMute };
}
