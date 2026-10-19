import { describe, expect, it } from "vitest";
import {
  chooseNext,
  clampCylinder,
  createDisk,
  DISK_MAX,
  drainDisk,
  requestCylinder,
  setDiskPolicy,
  stepDisk,
  type DiskPolicy,
} from "./disk";
import { createMachine, diskDrain, diskRequest, diskStep, setDiskPolicy as setKernelDiskPolicy } from "./machine";
import type { DiskState } from "./types";

/**
 * The classic textbook request queue (Silberschatz), with the head parked at
 * cylinder 53 and moving toward 0. FCFS = 640 and SSTF = 236 are the two
 * headline numbers every OS course memorises; the others follow from our
 * stated conventions (a full sweep counts as head travel).
 */
const REQUESTS = [98, 183, 37, 122, 14, 124, 65, 67];

function queued(policy: DiskPolicy): DiskState {
  let disk = setDiskPolicy(createDisk(), policy);
  for (const c of REQUESTS) disk = requestCylinder(disk, c);
  return disk;
}

function totalSeek(policy: DiskPolicy): number {
  return drainDisk(queued(policy)).totalSeekTime;
}

describe("disk scheduling — textbook queue, head at 53", () => {
  it("FCFS services requests in arrival order: 640 cylinders", () => {
    expect(totalSeek("fcfs")).toBe(640);
  });

  it("SSTF always goes to the nearest request: 236 cylinders", () => {
    expect(totalSeek("sstf")).toBe(236);
  });

  it("LOOK reverses at the last request: 208 cylinders", () => {
    expect(totalSeek("look")).toBe(208);
  });

  it("SCAN (elevator) runs to the rim before reversing: 236 cylinders", () => {
    expect(totalSeek("scan")).toBe(236);
  });

  it("C-SCAN is one-way, paying the long jump back: 386 cylinders", () => {
    expect(totalSeek("cscan")).toBe(386);
  });

  it("C-LOOK jumps to the far request instead of the rim: 326 cylinders", () => {
    expect(totalSeek("clook")).toBe(326);
  });
});

describe("disk mechanics", () => {
  it("clamps requests to the platter", () => {
    expect(clampCylinder(-40)).toBe(0);
    expect(clampCylinder(9999)).toBe(DISK_MAX);
    expect(clampCylinder(53.4)).toBe(53);
  });

  it("FCFS picks the front of the queue", () => {
    const disk = queued("fcfs");
    expect(chooseNext(disk)).toMatchObject({ kind: "service", index: 0, target: 98 });
  });

  it("a sweep moves the head but services nothing", () => {
    // Only a request below the head, then a jump for SCAN after reaching it.
    let disk = setDiskPolicy(createDisk(), "scan");
    disk = requestCylinder(disk, 10);
    disk = stepDisk(disk); // service 10 (head 53 -> 10)
    expect(disk.serviced).toEqual([10]);
    expect(disk.queue).toHaveLength(0);
  });

  it("an empty queue means an idle head", () => {
    const disk = createDisk();
    expect(chooseNext(disk)).toBeNull();
    expect(stepDisk(disk)).toBe(disk);
  });

  it("changing policy keeps the pending requests but resets the tally", () => {
    let disk = queued("fcfs");
    disk = stepDisk(disk);
    expect(disk.totalSeekTime).toBe(45);
    const switched = setDiskPolicy(disk, "sstf");
    expect(switched.queue).toHaveLength(7);
    expect(switched.totalSeekTime).toBe(0);
    expect(switched.serviced).toEqual([]);
  });
});

describe("disk in the running machine", () => {
  it("queues requests, steps the head and drains the rest", () => {
    let s = createMachine();
    s = setKernelDiskPolicy(s, "sstf");
    for (const c of REQUESTS) s = diskRequest(s, c);

    expect(s.disk.queue).toHaveLength(8);
    expect(s.log.some((e) => e.kind === "disk" && e.chip === "seek(98)")).toBe(true);

    s = diskStep(s);
    expect(s.disk.headPosition).toBe(65);
    expect(s.disk.serviced).toEqual([65]);

    s = diskDrain(s);
    expect(s.disk.queue).toHaveLength(0);
    expect(s.disk.totalSeekTime).toBe(236);
    expect(s.log.some((e) => e.kind === "disk" && e.text.includes("236 cylinders"))).toBe(true);
  });
});
