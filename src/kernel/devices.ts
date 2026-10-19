import type { DeviceState, Pid } from "./types";

/**
 * Devices (milestone M6).
 *
 * Some apps need a physical resource that only exists once: the Printer app
 * needs the printer, the Camera needs the camera, the Music Player needs the
 * speakers. A process takes the device when it is admitted and keeps it until
 * it exits, so a second app that wants the same device has to wait in the
 * device's queue. That wait is what `ProcessState.waiting` and
 * `Pcb.blockedTime` are for.
 *
 * Two processes that each hold one device and wait for the other form a
 * wait-for cycle — a deadlock. `findDeadlock` reads that cycle straight out of
 * the device queues.
 */

export const DEVICE_DEFS: { id: string; name: string; instances: number }[] = [
  { id: "printer", name: "Printer", instances: 1 },
  { id: "camera", name: "Camera", instances: 1 },
  { id: "speakers", name: "Speakers", instances: 1 },
];

export function createDevices(): DeviceState[] {
  return DEVICE_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    instances: d.instances,
    heldBy: [],
    waitQueue: [],
  }));
}

export function deviceName(devices: DeviceState[], id: string): string {
  return devices.find((d) => d.id === id)?.name ?? id;
}

export interface AcquireOutcome {
  devices: DeviceState[];
  granted: boolean;
  /** The process currently holding the device, when the request had to wait. */
  holder: Pid | null;
}

/**
 * Ask for a device. Grants it when a slot is free; otherwise appends the pid to
 * the wait queue. Re-requesting a device you already hold is a no-op.
 */
export function acquire(devices: DeviceState[], id: string, pid: Pid): AcquireOutcome {
  const index = devices.findIndex((d) => d.id === id);
  if (index < 0) return { devices, granted: true, holder: null };

  const device = devices[index];
  if (device.heldBy.includes(pid)) return { devices, granted: true, holder: null };
  if (device.waitQueue.includes(pid)) {
    return { devices, granted: false, holder: device.heldBy[0] ?? null };
  }

  if (device.heldBy.length < device.instances) {
    const next = devices.slice();
    next[index] = { ...device, heldBy: [...device.heldBy, pid] };
    return { devices: next, granted: true, holder: null };
  }

  const next = devices.slice();
  next[index] = { ...device, waitQueue: [...device.waitQueue, pid] };
  return { devices: next, granted: false, holder: device.heldBy[0] ?? null };
}

export interface ReleaseOutcome {
  devices: DeviceState[];
  /** The waiting process that was handed the device, if any. */
  grantedTo: Pid | null;
}

/** Release one device, passing it straight to the front of the wait queue. */
export function release(devices: DeviceState[], id: string, pid: Pid): ReleaseOutcome {
  const index = devices.findIndex((d) => d.id === id);
  if (index < 0) return { devices, grantedTo: null };

  const device = devices[index];
  const heldBy = device.heldBy.filter((p) => p !== pid);
  if (heldBy.length === device.heldBy.length) return { devices, grantedTo: null };

  let waitQueue = device.waitQueue;
  let grantedTo: Pid | null = null;
  if (heldBy.length < device.instances && waitQueue.length > 0) {
    grantedTo = waitQueue[0];
    waitQueue = waitQueue.slice(1);
    heldBy.push(grantedTo);
  }

  const next = devices.slice();
  next[index] = { ...device, heldBy, waitQueue };
  return { devices: next, grantedTo };
}

/** Release every device a process holds (exit, kill, or a device reset). */
export function releaseAll(
  devices: DeviceState[],
  pid: Pid,
): { devices: DeviceState[]; granted: { pid: Pid; deviceId: string }[] } {
  let next = devices;
  const granted: { pid: Pid; deviceId: string }[] = [];

  for (const device of devices) {
    if (!device.heldBy.includes(pid)) continue;
    const outcome = release(next, device.id, pid);
    next = outcome.devices;
    if (outcome.grantedTo !== null) granted.push({ pid: outcome.grantedTo, deviceId: device.id });
  }

  return { devices: next, granted };
}

/** Remove a pid from every wait queue — used when a waiting process is killed. */
export function dropFromQueues(devices: DeviceState[], pid: Pid): DeviceState[] {
  let changed = false;
  const next = devices.map((device) => {
    if (!device.waitQueue.includes(pid)) return device;
    changed = true;
    return { ...device, waitQueue: device.waitQueue.filter((p) => p !== pid) };
  });
  return changed ? next : devices;
}

/**
 * Follow "who is waiting for whom" through the device queues and return every
 * pid in a cycle. Returns null when the graph is acyclic, which is the normal
 * case. This is deliberately a simple cycle search: the graph is tiny.
 */
export function findDeadlock(devices: DeviceState[]): Pid[] | null {
  const waitsFor = new Map<Pid, Pid[]>();
  for (const device of devices) {
    for (const pid of device.waitQueue) {
      waitsFor.set(pid, [...(waitsFor.get(pid) ?? []), ...device.heldBy]);
    }
  }

  const colour = new Map<Pid, 0 | 1 | 2>();
  const stack: Pid[] = [];
  let cycle: Pid[] | null = null;

  const visit = (pid: Pid): boolean => {
    colour.set(pid, 1);
    stack.push(pid);

    for (const next of waitsFor.get(pid) ?? []) {
      const c = colour.get(next) ?? 0;
      if (c === 1) {
        cycle = stack.slice(stack.indexOf(next));
        return true;
      }
      if (c === 0 && visit(next)) return true;
    }

    stack.pop();
    colour.set(pid, 2);
    return false;
  };

  for (const pid of waitsFor.keys()) {
    if ((colour.get(pid) ?? 0) === 0 && visit(pid)) break;
  }

  return cycle;
}
