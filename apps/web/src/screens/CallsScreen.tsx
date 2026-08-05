import { formatConversationTimestamp, formatDuration, useChat, type CallRecord } from '@pingo/core';
import {
  Avatar,
  EmptyState,
  IconButton,
  LoadingState,
  PhoneIcon,
  VideoIcon,
  cn,
} from '@pingo/ui';
import { useEffect, useState } from 'react';

import { ScreenHeader } from '../components/ScreenHeader.js';
import { useCall } from '../features/calls/CallProvider.js';

/**
 * Call history.
 *
 * Deliberately a log, not a dialler. The board's dock puts calls one tap away, and
 * what a user wants there is almost always "call the person I just spoke to"  - 
 * so each row's own call buttons are the primary action.
 *
 * A missed call is marked with brand-coloured text and a rotated arrow glyph, not
 * red. Red would make a normal, frequent event feel like a failure every time the
 * screen opens.
 */
export function CallsScreen() {
  const { service, users } = useChat();
  const { startCall } = useCall();
  const [calls, setCalls] = useState<CallRecord[] | undefined>();

  useEffect(() => {
    let active = true;
    void service.listCalls().then((records) => {
      if (active) setCalls(records);
    });
    return () => {
      active = false;
    };
  }, [service]);

  return (
    <div className="h-full overflow-y-auto">
      <ScreenHeader title="Calls" />

      <div className="mx-auto w-full max-w-2xl px-3 py-3">
        {!calls ? (
          <LoadingState label="Loading calls" />
        ) : calls.length === 0 ? (
          <EmptyState
            title="No calls yet"
            description="Voice and video calls will appear here."
            icon={<PhoneIcon size={26} />}
          />
        ) : (
          <div className="space-y-0.5">
            {calls.map((call) => {
              const other = call.withUserId
                ? users.find((u) => u.id === call.withUserId)
                : undefined;
              const title = other?.name ?? 'Design Team';
              const missed = call.outcome === 'missed';

              return (
                <div
                  key={call.id}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-3',
                    'transition-colors duration-instant ease-standard hover:bg-hover',
                  )}
                >
                  <Avatar
                    name={title}
                    id={other?.id ?? call.conversationId ?? call.id}
                    size="md"
                    presence={other?.presence.state === 'online' ? 'online' : undefined}
                  />

                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-body',
                        missed ? 'font-medium text-ink' : 'text-ink',
                      )}
                    >
                      {title}
                    </p>

                    <p className="mt-0.5 flex items-center gap-1.5 text-caption">
                      {/*
                        A single arrow glyph, rotated: outgoing points up-right,
                        incoming points down-left. One shape, two meanings.
                      */}
                      <span
                        className={cn(
                          'inline-block',
                          missed ? 'text-brand' : 'text-text-tertiary',
                        )}
                        aria-hidden
                      >
                        {call.direction === 'outgoing' ? '↗' : '↙'}
                      </span>
                      {/*
                        Every outcome gets a word except the one that has a
                        number.

                        `unreachable` fell through to `formatDuration(0)`, so a
                        call that never got through read as "0:00" — which looks
                        like a call that was answered and lasted no time at all.
                        Four outcomes, four things said.
                      */}
                      <span className={missed ? 'text-brand' : 'text-text-secondary'}>
                        {missed
                          ? 'Missed'
                          : call.outcome === 'declined'
                            ? 'Declined'
                            : call.outcome === 'unreachable'
                              ? 'Not connected'
                              : formatDuration(call.duration)}
                      </span>
                      <span className="text-text-tertiary">·</span>
                      <span className="text-text-tertiary">
                        {formatConversationTimestamp(call.startedAt)}
                      </span>
                    </p>
                  </div>

                  {/*
                    Calling back needs someone to call - a group entry has no
                    single peer, so its button stays inert until group calls do.
                    The kind mirrors the logged call: you get back what you had.
                  */}
                  <IconButton
                    label={`${call.kind === 'video' ? 'Video' : 'Voice'} call ${title}`}
                    variant="ghost"
                    disabled={!other}
                    onClick={() => other && void startCall(other.id, other.name, call.kind)}
                  >
                    {call.kind === 'video' ? <VideoIcon size={20} /> : <PhoneIcon size={20} />}
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
