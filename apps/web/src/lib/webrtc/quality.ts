/**
 * What a call is actually doing on the wire.
 *
 * Every question about call quality was being answered by guessing, because
 * nothing here ever called `getStats`. "The voice breaks up on mobile" and "the
 * voice breaks up because a filter is wrong" look identical from the outside,
 * and they need opposite fixes - one is a bitrate that does not fit the link,
 * the other is a bug in the audio graph. These are the numbers that tell them
 * apart.
 *
 * ## Loss has to be measured over an interval
 *
 * `packetsLost` is cumulative for the lifetime of the call. A minute of trouble
 * at the start is still in that total ten minutes later, so a ratio taken
 * straight from it describes the call's history rather than the last few
 * seconds - which is exactly backwards for deciding whether to warn somebody
 * right now. Each sample is therefore differenced against the one before it,
 * and the first sample reports nothing.
 */

import type { CallQuality } from '@pingo/core';

/*
 * `weak` thresholds are the ones the ITU treats as the edge of acceptable for
 * conversational speech: 3% loss is where Opus can no longer conceal the gaps,
 * 30 ms of jitter is where the buffer starts choosing between latency and
 * dropouts, and 300 ms of round trip is where people begin talking over each
 * other. Any one of them is enough - they do not have to agree.
 */
const MAX_LOSS = 0.03;
const MAX_JITTER = 0.03;
const MAX_RTT = 0.3;

interface Previous {
  lost: number;
  received: number;
  bytesSent: number;
  at: number;
}

/**
 * Samples one peer connection. Hold the returned reader across a call.
 *
 * Stateful because of the differencing described above: the reader remembers
 * the previous counters so the caller does not have to.
 */
export function qualityReader(connection: RTCPeerConnection): () => Promise<CallQuality | undefined> {
  let previous: Previous | undefined;

  return async () => {
    let report: RTCStatsReport;
    try {
      report = await connection.getStats();
    } catch {
      return undefined;
    }

    let lost = 0;
    let received = 0;
    let jitter = 0;
    let rtt = 0;
    let codec = '';
    let bytesSent = 0;
    /** What the far end says it is losing of our stream, already an interval. */
    let remoteFractionLost = 0;
    const codecIds = new Set<string>();

    report.forEach((stat) => {
      const s = stat as Record<string, unknown> & { type: string };

      if (s.type === 'inbound-rtp' && s.kind === 'audio') {
        lost += Number(s.packetsLost ?? 0);
        received += Number(s.packetsReceived ?? 0);
        jitter = Math.max(jitter, Number(s.jitter ?? 0));
        if (typeof s.codecId === 'string') codecIds.add(s.codecId);
      }

      if (s.type === 'outbound-rtp' && s.kind === 'audio') {
        bytesSent += Number(s.bytesSent ?? 0);
        if (typeof s.codecId === 'string') codecIds.add(s.codecId);
      }

      if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') {
        remoteFractionLost = Math.max(remoteFractionLost, Number(s.fractionLost ?? 0));
        // Preferred over the candidate pair when present: this is the round
        // trip the media actually took, not the one the probes did.
        rtt = Math.max(rtt, Number(s.roundTripTime ?? 0));
      }

      if (s.type === 'candidate-pair' && s.nominated && rtt === 0) {
        rtt = Number(s.currentRoundTripTime ?? 0);
      }
    });

    report.forEach((stat) => {
      const s = stat as Record<string, unknown> & { type: string; id?: string };
      if (s.type === 'codec' && s.id && codecIds.has(s.id) && typeof s.mimeType === 'string') {
        codec = s.mimeType;
      }
    });

    const now = Date.now();
    const before = previous;
    previous = { lost, received, bytesSent, at: now };

    // First sample establishes the baseline and describes nothing.
    if (!before) return undefined;

    const deltaLost = Math.max(0, lost - before.lost);
    const deltaReceived = Math.max(0, received - before.received);
    const total = deltaLost + deltaReceived;
    const inboundLoss = total > 0 ? deltaLost / total : 0;

    const seconds = Math.max(0.001, (now - before.at) / 1000);
    const audioBitrate = Math.max(0, ((bytesSent - before.bytesSent) * 8) / seconds);

    const loss = Math.max(inboundLoss, remoteFractionLost);

    return {
      loss,
      jitter,
      rtt,
      codec,
      audioBitrate,
      weak: loss > MAX_LOSS || jitter > MAX_JITTER || rtt > MAX_RTT,
    };
  };
}
