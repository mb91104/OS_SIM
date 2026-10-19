# ToyOS

An interactive operating-system simulator for 11th and 12th graders. You get a
fake desktop, a real (deterministic) kernel, and an X-ray panel that shows what
the kernel is thinking.

The point is to make the textbook diagrams move: processes are launched from a
Dock, the CPU hands out time slices, pages get faulted in and out of frames, and
the disk head slides across the platter.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 67 unit + integration tests
npm run build      # type-check, then production build
```

`?demo=1` opens a fixed set of apps. Add `&ff=45` to fast-forward 45 simulated
milliseconds.

## What works today

| Milestone | Status | What you can do |
|---|---|---|
| **M1** Boot & Round Robin | done | Launch apps, watch New → Ready → Running → Exited, Gantt timeline, rewind every tick |
| **M2** Scheduling policies | done | Round Robin, FCFS, SJF, SRTF, Priority; time-slice slider; priority editing; textbook averages |
| **M3** Memory | done | 2–32 frames, per-process page loads, frame table, free-on-exit |
| **M4** Paging & replacement | done | Demand paging, hits/faults, LRU / FIFO / Clock / OPT(timal) |
| **M5** Disk scheduling | done | FCFS, SSTF, SCAN, C-SCAN, LOOK, C-LOOK; seek totals and head animation |
| **M6** Devices & deadlock | planned | `waiting` state, `blockedTime` and device types are reserved |
| **M7** Shareable scenarios | done | A Share button copies a link that rebuilds the same seed, settings and apps |

### The X-ray panel

- **CPU & queues** — what owns the core, the ready/new queues, live state counts.
- **Processes** — the raw PCB table, including remaining burst, resident pages,
  waiting/turnaround time and aggregate averages.
- **Memory** — the frame table, resident pages per process, hits, faults, fault
  rate, evictions, plus live frame-count and replacement-policy controls.
- **Disk** — an SVG platter view, the pending request queue, the head's last
  movement, and the seek total for the chosen policy.
- **Inspect** — a plain-English explanation of one process, plus kill and
  reprioritise actions.

## Design rules

The kernel is a **pure reducer**. Everything that changes the machine goes
through a syscall or `tick()`, which advances simulated time by exactly one
millisecond. There are no timers, no `Date.now()`, no DOM and no randomness
outside the seeded RNG inside `MachineState`.

That gives three useful properties:

1. **Determinism** — the same seed and the same clicks always produce the same
   machine, so tests can assert exact textbook answers.
2. **Replay** — the store keeps one snapshot per tick, so the scrubber can walk
   backwards through history without side effects.
3. **Testability** — scheduling and memory questions have hand-computable
   answers, and the suite checks them.

### Layout

```
src/kernel/   pure simulator: machine.ts (CPU/scheduler), memory.ts, disk.ts,
              types.ts, catalog.ts, seeded rng.ts, plus unit tests
src/state/    zustand stores (machine history + UI), clock, scenario links
src/ui/       toolbar, timeline, desktop, dock, task manager, X-ray sections
src/lib/      formatting helpers and shared state colours
src/styles/   one global stylesheet (dark, projector-friendly)
```

## Keyboard

| Key | Action |
|---|---|
| `Space` | run / pause |
| `→` or `.` | step one simulated millisecond |
| `X` | toggle the X-ray panel |
| `Esc` | deselect the inspected process |

## Scenario links

The Share button serialises the current *setup* — seed, policy, quantum, frame
count, replacement policy and the list of launched apps — into the query string:

```
/?s=20261018&p=srtf&q=12&f=8&r=lru&apps=browser,music,photos
```

Because bursts are drawn from the seeded RNG, opening the link rebuilds the same
machine exactly. `ff` fast-forwards after loading.

## Testing

```bash
npm test
```

Coverage highlights:

- **Round Robin reference example** — three 30 ms jobs at quantum 12 finish at
  79/85/91 ms, average waiting 55 ms.
- **All five schedulers** — hand-checked completion and waiting times.
- **Page replacement** — the classic `7,0,1,2,0,3,0,4,2,3,0,3,2,1,2,0,1,7,0,1`
  string with 3 frames gives FIFO 15, LRU 12, OPT 9 faults.
- **Disk scheduling** — the textbook queue at cylinder 53 gives FCFS 640,
  SSTF 236, LOOK 208, SCAN 236, C-SCAN 386, C-LOOK 326 cylinders.
- **UI smoke tests** — the whole shell mounts in jsdom and exercises launch,
  kill, rewind, memory controls and the disk tab.
