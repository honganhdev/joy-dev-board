import { describe, expect, test } from 'bun:test';
import { buildTicketTimeline } from '../src/lib/ticket-timeline';
import type { StatusHistoryEntry } from '../src/types';

const NOW = Date.parse('2026-08-24T10:00:00.000Z');

function entry(partial: Partial<StatusHistoryEntry>): StatusHistoryEntry {
  return {
    fromStatus: null,
    toStatus: 'dev_fixing',
    observedAt: '2026-08-24T09:00:00.000Z',
    ticketUpdatedAt: null,
    ...partial,
  };
}

describe('buildTicketTimeline', () => {
  test('a first observation is not a transition and carries no duration', () => {
    // The case the old sheet got wrong: created 3 Aug, board booted 24 Aug.
    const timeline = buildTicketTimeline(
      [entry({ fromStatus: null, toStatus: 'dev_fixing', observedAt: '2026-08-24T09:46:00.000Z' })],
      { createdAt: '2026-08-03T02:00:00.000Z', updatedAt: null, doneAt: null, tsStatus: 'dev_fixing' },
      NOW
    );

    expect(timeline.observedSince).toBeNull();
    expect(timeline.observedForMs).toBeNull();
    expect(timeline.firstSeenAt).toBe('2026-08-24T09:46:00.000Z');

    const sighting = timeline.events.find((event) => event.kind === 'first-seen');
    expect(sighting?.heldMs).toBeUndefined();
    expect(sighting?.fromStatus).toBeUndefined();
  });

  test('a real observed transition keeps its measured duration', () => {
    const timeline = buildTicketTimeline(
      [
        entry({ fromStatus: null, toStatus: 'doing', observedAt: '2026-08-24T06:00:00.000Z' }),
        entry({ fromStatus: 'doing', toStatus: 'dev_done', observedAt: '2026-08-24T08:00:00.000Z' }),
      ],
      { createdAt: '2026-08-20T00:00:00.000Z', updatedAt: null, doneAt: null, tsStatus: 'dev_done' },
      NOW
    );

    expect(timeline.observedSince).toBe('2026-08-24T08:00:00.000Z');
    expect(timeline.observedForMs).toBe(2 * 60 * 60 * 1000);

    const move = timeline.events.find((event) => event.kind === 'transition');
    expect(move?.fromStatus).toBe('doing');
    expect(move?.heldMs).toBe(2 * 60 * 60 * 1000);
  });

  test('an earlier transition is held until the next observation, not until now', () => {
    const timeline = buildTicketTimeline(
      [
        entry({ fromStatus: 'doing', toStatus: 'dev_fixing', observedAt: '2026-08-24T06:00:00.000Z' }),
        entry({ fromStatus: 'dev_fixing', toStatus: 'done', observedAt: '2026-08-24T07:00:00.000Z' }),
      ],
      { createdAt: null, updatedAt: null, doneAt: null, tsStatus: 'done' },
      NOW
    );

    const [first] = timeline.events.filter((event) => event.kind === 'transition');
    expect(first?.heldMs).toBe(60 * 60 * 1000);
  });

  test('HelpDesk timestamps are placed in the chronology as exact events', () => {
    const timeline = buildTicketTimeline(
      [entry({ observedAt: '2026-08-24T09:00:00.000Z', toStatus: 'done' })],
      {
        createdAt: '2026-08-21T17:58:54.904Z',
        updatedAt: '2026-08-22T05:00:00.000Z',
        doneAt: '2026-08-22T04:59:01.082Z',
        tsStatus: 'done',
      },
      NOW
    );

    expect(timeline.events.map((event) => [event.kind, event.source])).toEqual([
      ['created', 'helpdesk'],
      ['done', 'helpdesk'],
      ['updated', 'helpdesk'],
      ['first-seen', 'board'],
    ]);
  });

  test('does not repeat creation as an update when nothing has changed since', () => {
    const timeline = buildTicketTimeline(
      [],
      {
        createdAt: '2026-08-21T17:58:54.904Z',
        updatedAt: '2026-08-21T17:58:54.904Z',
        doneAt: null,
        tsStatus: 'pending',
      },
      NOW
    );
    expect(timeline.events.map((event) => event.kind)).toEqual(['created']);
  });

  test('prefers HelpDesk’s current status over the last thing observed', () => {
    const timeline = buildTicketTimeline(
      [entry({ fromStatus: 'doing', toStatus: 'dev_done', observedAt: '2026-08-24T08:00:00.000Z' })],
      { createdAt: null, updatedAt: null, doneAt: null, tsStatus: 'done' },
      NOW
    );
    // Status moved after the last pull, so "since" would be a guess.
    expect(timeline.status).toBe('done');
    expect(timeline.observedSince).toBeNull();
  });

  test('survives an empty history and unparseable timestamps', () => {
    const timeline = buildTicketTimeline(
      [entry({ observedAt: 'not-a-date' })],
      { createdAt: 'nonsense', updatedAt: null, doneAt: null, tsStatus: 'doing' },
      NOW
    );
    expect(timeline.events).toEqual([]);
    expect(timeline.firstSeenAt).toBeNull();
    expect(timeline.status).toBe('doing');
  });

  test('orders events oldest first regardless of input order', () => {
    const timeline = buildTicketTimeline(
      [
        entry({ fromStatus: 'doing', toStatus: 'done', observedAt: '2026-08-24T09:00:00.000Z' }),
        entry({ fromStatus: null, toStatus: 'doing', observedAt: '2026-08-24T06:00:00.000Z' }),
      ],
      { createdAt: '2026-08-01T00:00:00.000Z', updatedAt: null, doneAt: null, tsStatus: 'done' },
      NOW
    );

    const times = timeline.events.map((event) => Date.parse(event.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(timeline.observedSince).toBe('2026-08-24T09:00:00.000Z');
  });
});
