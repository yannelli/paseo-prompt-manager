import assert from "node:assert/strict";
import { test } from "node:test";
import type { LibrarySettings } from "../shared/prompts.ts";
import { SyncScheduler } from "./sync.ts";

type Gate = { promise: Promise<void>; open: () => void };
const gate = (): Gate => {
  let open = () => {};
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
};
const settle = async () => { for (let step = 0; step < 10; step++) await Promise.resolve(); };

function harness(settings: Partial<LibrarySettings>, options: { initialized?: boolean; fail?: string } = {}) {
  let clock = Date.parse("2026-10-06T12:00:00.000Z");
  const runs: Gate[] = [];
  let synced = 0;
  const saved: LibrarySettings = { directory: "/library", gitEnabled: true, syncMode: "manual", syncInterval: 15, ...settings };
  const scheduler = new SyncScheduler({
    settings: async () => saved,
    initialized: async () => options.initialized ?? true,
    sync: async () => {
      const run = gate();
      runs.push(run);
      await run.promise;
      if (options.fail) throw new Error(options.fail);
      return { message: "Synced with origin." };
    },
    synced: () => { synced++; },
    debounceMs: 1_000,
    openThrottleMs: 60_000,
    now: () => clock,
  });
  return { scheduler, runs, saved, synced: () => synced, advance: (ms: number) => { clock += ms; } };
}

test("after-changes mode waits for writes to settle and never overlaps syncs", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { scheduler, runs, synced } = harness({ syncMode: "changes" });
  await scheduler.reload();
  scheduler.changed();
  t.mock.timers.tick(500);
  scheduler.changed();
  t.mock.timers.tick(999);
  await settle();
  assert.equal(runs.length, 0);
  t.mock.timers.tick(1);
  await settle();
  assert.equal(runs.length, 1);
  assert.equal((await scheduler.snapshot()).running, true);
  scheduler.changed();
  t.mock.timers.tick(1_000);
  await settle();
  assert.equal(runs.length, 1, "a change during a sync queues one follow-up run");
  runs[0]!.open();
  await settle();
  assert.equal(runs.length, 2);
  runs[1]!.open();
  await settle();
  const state = await scheduler.snapshot();
  assert.equal(state.running, false);
  assert.equal(state.lastMessage, "Synced with origin.");
  assert.equal(state.lastSyncedAt, "2026-10-06T12:00:00.000Z");
  assert.equal(synced(), 2);
  scheduler.dispose();
});

test("interval mode syncs on schedule and reload stops the timer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const { scheduler, runs, saved } = harness({ syncMode: "interval", syncInterval: 5 });
  await scheduler.reload();
  assert.equal((await scheduler.snapshot()).nextSyncAt, "2026-10-06T12:05:00.000Z");
  t.mock.timers.tick(5 * 60_000);
  await settle();
  assert.equal(runs.length, 1);
  runs[0]!.open();
  await settle();
  saved.syncMode = "manual";
  await scheduler.reload();
  assert.equal((await scheduler.snapshot()).nextSyncAt, null);
  t.mock.timers.tick(10 * 60_000);
  scheduler.changed();
  t.mock.timers.tick(1_000);
  await settle();
  assert.equal(runs.length, 1);
  scheduler.dispose();
});

test("opening the library pulls at most once per throttle window and skips uninitialized repositories", async (t) => {
  const { scheduler, runs, advance } = harness({ syncMode: "changes" });
  await scheduler.reload();
  await scheduler.opened();
  await settle();
  assert.equal(runs.length, 1);
  runs[0]!.open();
  await settle();
  await scheduler.opened();
  await settle();
  assert.equal(runs.length, 1);
  advance(60_000);
  await scheduler.opened();
  await settle();
  assert.equal(runs.length, 2);
  runs[1]!.open();
  await settle();
  const manual = harness({ syncMode: "manual" });
  await manual.scheduler.reload();
  await manual.scheduler.opened();
  const fresh = harness({ syncMode: "changes" }, { initialized: false });
  await fresh.scheduler.reload();
  const state = await fresh.scheduler.opened();
  await settle();
  assert.equal(manual.runs.length + fresh.runs.length, 0);
  assert.equal(state.initialized, false);
});

test("connection changes wait for a running sync and block new ones", async () => {
  const { scheduler, runs, synced } = harness({ syncMode: "changes" });
  await scheduler.reload();
  const events: string[] = [];
  const sync = scheduler.syncNow();
  await settle();
  const connect = scheduler.exclusive(async () => { events.push(`connect after ${synced()} sync`); });
  await settle();
  assert.deepEqual(events, []);
  runs[0]!.open();
  await Promise.all([sync, connect]);
  assert.deepEqual(events, ["connect after 1 sync"]);
  const blocker = gate();
  const held = scheduler.exclusive(() => blocker.promise);
  const next = scheduler.syncNow();
  await settle();
  assert.equal(runs.length, 1);
  blocker.open();
  await held;
  await settle();
  runs[1]!.open();
  await next;
});

test("manual sync reports errors and background errors are recorded without throwing", async (t) => {
  const { scheduler, runs } = harness({ syncMode: "changes" }, { fail: "Authentication failed" });
  await scheduler.reload();
  const manual = scheduler.syncNow();
  await settle();
  runs[0]!.open();
  await assert.rejects(manual, /Authentication failed/);
  assert.equal((await scheduler.snapshot()).lastError, "Authentication failed");
  scheduler.trigger();
  await settle();
  runs[1]!.open();
  await settle();
  const state = await scheduler.snapshot();
  assert.equal(state.lastError, "Authentication failed");
  assert.equal(state.lastSyncedAt, null);
});
