// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { ActivityBinder } from "./ActivityBinder";
import type { SceneActivityBinding } from "./ActivityBinder";

describe("ActivityBinder", () => {
  it("saves a well-formed SceneActivityBinding matching YaraBedScene's ActivityData shape", async () => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const binder = new ActivityBinder(mount);
    const saved: Array<[number, SceneActivityBinding | null]> = [];
    binder.setOnSave(async (sceneIndex, activity) => {
      saved.push([sceneIndex, activity]);
      return { ok: true };
    });

    binder.open(
      1,
      "مشهد يارا",
      null,
      [{ id: "scene03", label: "البحث عن الدمية" }],
      [{ alias: "doll", src: "/x/doll.png", type: "image" }],
      [{ alias: "yara-success", src: "/x/yara-success.mp3", type: "audio" }]
    );

    // Fill the word field
    const wordInput = mount.querySelector("#ab-word") as HTMLInputElement;
    wordInput.value = "دمية";
    wordInput.dispatchEvent(new Event("input"));

    // Pick the letter at index 2 (ي) as the missing one
    const chips = mount.querySelectorAll(".ab-chip");
    expect(chips.length).toBe(4);
    (chips[2] as HTMLElement).click();

    // Set an onSolved field
    const nextSceneSelect = mount.querySelector("#ab-nextscene") as HTMLSelectElement;
    nextSceneSelect.value = "scene03";
    nextSceneSelect.dispatchEvent(new Event("change"));

    // Save
    const saveBtn = mount.querySelector("#ab-save-btn") as HTMLButtonElement;
    saveBtn.click();
    await vi.waitFor(() => expect(saved.length).toBe(1));

    const [sceneIndex, activity] = saved[0]!;
    expect(sceneIndex).toBe(1);
    expect(activity).toEqual({
      type: "drag-match",
      word: "دمية",
      letters: ["د", "م", "ي", "ة"],
      missingIndex: 2,
      matchTolerance: undefined,
      onSolved: { nextScene: "scene03" }
    });

    binder.destroy();
  });

  it("refuses to save an empty word (never persists a broken activity)", async () => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const binder = new ActivityBinder(mount);
    const saveFn = vi.fn(async () => ({ ok: true as const }));
    binder.setOnSave(saveFn);
    binder.open(0, "مشهد فارغ", null, [], [], []);

    const saveBtn = mount.querySelector("#ab-save-btn") as HTMLButtonElement;
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 10));

    expect(saveFn).not.toHaveBeenCalled();
    binder.destroy();
  });

  it("remove() calls onSave with null (so it actually persists the removal)", async () => {
    document.body.innerHTML = "";
    const mount = document.createElement("div");
    document.body.appendChild(mount);

    const binder = new ActivityBinder(mount);
    const saved: Array<SceneActivityBinding | null> = [];
    binder.setOnSave(async (_i, activity) => {
      saved.push(activity);
      return { ok: true };
    });

    binder.open(
      2,
      "مشهد له نشاط",
      { type: "drag-match", word: "قطة", letters: ["ق", "ط", "ة"], missingIndex: 1 },
      [],
      [],
      []
    );

    const removeBtn = mount.querySelector("#ab-remove-btn") as HTMLButtonElement;
    expect(removeBtn).toBeTruthy();
    removeBtn.click();
    await vi.waitFor(() => expect(saved.length).toBe(1));
    expect(saved[0]).toBeNull();

    binder.destroy();
  });
});
