import { describe, expect, it } from "vitest";
import { cylinderForBlock, createFs, deleteFile, listFiles } from "./fs";
import { createMachine, fsCreate, fsDelete, fsRead } from "./machine";

describe("filesystem", () => {
  it("starts with a root directory and free blocks", () => {
    const fs = createFs();
    expect(fs).toHaveLength(24);
    expect(fs[0].kind).toBe("dir");
    expect(fs.filter((b) => b.kind === "free")).toHaveLength(23);
    expect(listFiles(fs)).toEqual([]);
  });

  it("allocates a contiguous run and frees it again", () => {
    const fs = createFs();
    const first = fsCreate({ ...createMachine(), fs }, "notes.txt", 3);
    const files = listFiles(first.fs);

    expect(files).toEqual([{ name: "notes.txt", start: 1, blocks: 3 }]);
    expect(first.fs[1].kind).toBe("index");
    expect(first.fs[2].kind).toBe("file");
    expect(first.fs[3].kind).toBe("file");

    const cleared = deleteFile(first.fs, "notes.txt");
    expect(listFiles(cleared)).toEqual([]);
    expect(cleared.slice(1, 4).every((b) => b.kind === "free")).toBe(true);
  });

  it("refuses duplicate names and files that do not fit", () => {
    let state = createMachine();
    state = fsCreate(state, "a.bin", 3);
    const duplicate = fsCreate(state, "a.bin", 1);
    expect(duplicate.fs).toBe(state.fs);
    expect(duplicate.log.at(-1)?.text).toContain("Could not create");

    const tooBig = fsCreate(state, "huge.bin", 99);
    expect(tooBig.fs).toBe(state.fs);
  });

  it("turns a file read into one disk request per block", () => {
    let state = createMachine();
    state = fsCreate(state, "photo.raw", 3);
    state = fsRead(state, "photo.raw");

    expect(state.disk.queue).toEqual([
      cylinderForBlock(1),
      cylinderForBlock(2),
      cylinderForBlock(3),
    ]);
    expect(state.filesRead).toBe(1);
  });

  it("logs a missing file instead of queueing anything", () => {
    const state = fsRead(createMachine(), "ghost.txt");
    expect(state.disk.queue).toEqual([]);
    expect(state.log.at(-1)?.text).toContain("no file");
  });

  it("removes a file and its blocks through the syscall", () => {
    let state = createMachine();
    state = fsCreate(state, "draft.txt", 2);
    const before = state.fs.filter((b) => b.kind !== "free").length;
    state = fsDelete(state, "draft.txt");

    expect(state.fs.filter((b) => b.kind !== "free")).toHaveLength(before - 2);
    expect(state.fs.filter((b) => b.kind !== "free")).toHaveLength(1); // root dir
  });
});
