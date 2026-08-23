// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { Container } from "pixi.js";
import { DialoguePlayer } from "./DialoguePlayer";

function makeMockAudio() {
  return { play: vi.fn() } as unknown as import("@core/audio/AudioManager").AudioManager;
}

describe("DialoguePlayer", () => {
  it("is hidden until show() is called", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    expect(player.isVisible).toBe(false);
    player.show();
    expect(player.isVisible).toBe(true);
    player.destroy();
  });

  it("showLine() displays speaker/text and plays the line's audio if present", () => {
    const audio = makeMockAudio();
    const container = new Container();
    const player = new DialoguePlayer(container, audio, { designWidth: 1920, designHeight: 1080 }, () => {});

    player.showLine("يارا", "مرحبًا!", "yara-welcome");
    expect(audio.play).toHaveBeenCalledWith("yara-welcome", { channel: "voice", volume: 0.8 });
    player.destroy();
  });

  it("showLine() does not call audio.play() when a line has no audio", () => {
    const audio = makeMockAudio();
    const container = new Container();
    const player = new DialoguePlayer(container, audio, { designWidth: 1920, designHeight: 1080 }, () => {});

    player.showLine("يارا", "بلا صوت");
    expect(audio.play).not.toHaveBeenCalled();
    player.destroy();
  });

  it("works identically regardless of which scene/story the line belongs to — no positional assumption, just speaker/text/audio in, displayed out", () => {
    const audio = makeMockAudio();
    const container = new Container();
    const player = new DialoguePlayer(container, audio, { designWidth: 1920, designHeight: 1080 }, () => {});

    player.showLine("قطة", "مواء!", "cat-meow");
    expect(audio.play).toHaveBeenCalledWith("cat-meow", { channel: "voice", volume: 0.8 });

    player.showLine("", "سطر بلا متحدث");
    expect(() => player.showLine(undefined, undefined)).not.toThrow();
    player.destroy();
  });

  it("tapping the dialogue box calls the supplied onTap callback", () => {
    const container = new Container();
    const onTap = vi.fn();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, onTap);

    // The box is the sole child added to the container.
    const box = container.children[0] as unknown as { emit: (event: string) => void };
    box.emit("pointertap");
    expect(onTap).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it("reports that a voice-over started, so the caller can pace on it", () => {
    const audio = { play: vi.fn(() => 7) } as unknown as import("@core/audio/AudioManager").AudioManager;
    const container = new Container();
    const player = new DialoguePlayer(container, audio, { designWidth: 1920, designHeight: 1080 }, () => {});

    expect(player.showLine("يارا", "مرحبًا!", "yara-welcome")).toBe(true);
    player.destroy();
  });

  it("reports no voice-over for a line without audio", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});

    expect(player.showLine("يارا", "بلا صوت")).toBe(false);
    player.destroy();
  });

  it("reports no voice-over when the clip could not play — waiting on it would hang the story", () => {
    // AudioManager returns id 0 for a clip it never loaded. Treating that
    // as "started" would leave the caller waiting for an onComplete that
    // can never fire.
    const audio = { play: vi.fn(() => 0) } as unknown as import("@core/audio/AudioManager").AudioManager;
    const container = new Container();
    const player = new DialoguePlayer(container, audio, { designWidth: 1920, designHeight: 1080 }, () => {});

    expect(player.showLine("يارا", "ملف مفقود", "missing")).toBe(false);
    player.destroy();
  });

  it("hands the caller's completion callback to the audio layer", () => {
    const audio = { play: vi.fn(() => 3) } as unknown as import("@core/audio/AudioManager").AudioManager;
    const container = new Container();
    const player = new DialoguePlayer(container, audio, { designWidth: 1920, designHeight: 1080 }, () => {});
    const onVoiceEnd = vi.fn();

    player.showLine("يارا", "مرحبًا", "yara-welcome", onVoiceEnd);

    expect(audio.play).toHaveBeenCalledWith("yara-welcome", {
      channel: "voice",
      volume: 0.8,
      onComplete: onVoiceEnd
    });
    player.destroy();
  });

  it("showChoices() renders one button per choice and reports the pending decision", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    const box = container.children[0] as unknown as Container;
    const childrenBefore = box.children.length;

    expect(player.hasChoices).toBe(false);
    player.showChoices(
      [
        { id: "truth", label: "سأقول الحقيقة" },
        { id: "lie", label: "سأخفي الأمر" }
      ],
      () => {}
    );

    expect(player.hasChoices).toBe(true);
    const layer = box.children[childrenBefore] as unknown as Container;
    expect(layer.children.length).toBe(2);
    player.destroy();
  });

  it("stops the box from advancing while a decision is pending, and restores it after", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    const box = container.children[0] as unknown as Container;

    expect(box.interactive).toBe(true);
    player.showChoices([{ id: "a", label: "أ" }], () => {});
    // A stray tap must not silently pick a path for the child.
    expect(box.interactive).toBe(false);

    player.showLine("يارا", "بعد الاختيار");
    expect(box.interactive).toBe(true);
    expect(player.hasChoices).toBe(false);
    player.destroy();
  });

  it("tapping a choice reports its id once and dismisses the buttons", () => {
    const container = new Container();
    const onChoose = vi.fn();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    const box = container.children[0] as unknown as Container;
    const childrenBefore = box.children.length;

    player.showChoices(
      [
        { id: "truth", label: "الحقيقة" },
        { id: "lie", label: "الكذب" }
      ],
      onChoose
    );
    const layer = box.children[childrenBefore] as unknown as Container;
    const secondButton = layer.children[1] as unknown as { emit: (event: string) => void };
    secondButton.emit("pointertap");

    expect(onChoose).toHaveBeenCalledExactlyOnceWith("lie");
    // Dismissed immediately, so a second tap during the scene transition
    // cannot fire a second branch.
    expect(player.hasChoices).toBe(false);
    player.destroy();
  });

  it("a plain line never leaves stale choice buttons on screen", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    const box = container.children[0] as unknown as Container;
    const childrenBefore = box.children.length;

    player.showChoices([{ id: "a", label: "أ" }], () => {});
    expect(box.children.length).toBe(childrenBefore + 1);

    player.showLine("يارا", "سطر عادي");
    expect(box.children.length).toBe(childrenBefore);
    player.destroy();
  });

  it("showChoices() with an empty list is a no-op, not an unleavable line", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    const box = container.children[0] as unknown as Container;

    player.showChoices([], () => {});
    expect(player.hasChoices).toBe(false);
    expect(box.interactive).toBe(true);
    player.destroy();
  });

  it("destroy() removes the dialogue box from the container", () => {
    const container = new Container();
    const player = new DialoguePlayer(container, makeMockAudio(), { designWidth: 1920, designHeight: 1080 }, () => {});
    expect(container.children.length).toBe(1);
    player.destroy();
    // Pixi's destroy({children:true}) detaches from parent as part of teardown.
    expect(container.children.length).toBe(0);
  });
});
