/**
 * game/scenes/DialoguePlayer.ts
 *
 * Single responsibility: the dialogue box UI, and displaying one line
 * (speaker + text + its voice-over audio) at a time.
 *
 * Extracted from the YaraBedScene monolith per
 * system-architecture-redesign.md (section 5, module 3 of 4).
 *
 * Deliberately narrow scope, same boundary principle as PuzzleRunner
 * (module 2): this class does not know which scene or line index is
 * "current," and does not dispatch a line's side effects (showObject,
 * showCharacter, startPuzzle, afterPuzzle) — those are scene-orchestration
 * concerns that belong one level up (today: YaraBedScene; eventually:
 * SceneRuntime, module 4). DialoguePlayer's job is exactly: given a line's
 * speaker/text/audio, display it — and tell the caller when the box was
 * tapped to advance. Nothing about *which* line comes next.
 */

import { Text, TextStyle, Container, Graphics } from "pixi.js";
import type { AudioManager } from "@core/audio/AudioManager";

export interface DialoguePlayerConfig {
  designWidth: number;
  designHeight: number;
}

export class DialoguePlayer {
  private readonly container: Container;
  private readonly audio: AudioManager;
  private box: Container | null = null;
  private speakerText: Text | null = null;
  private lineText: Text | null = null;
  private advanceHint: Text | null = null;
  /** Holds the choice buttons while a decision is pending. */
  private choiceLayer: Container | null = null;
  private designWidth = 1920;

  constructor(container: Container, audio: AudioManager, config: DialoguePlayerConfig, onTap: () => void) {
    this.container = container;
    this.audio = audio;
    this.build(config, onTap);
  }

  private build(config: DialoguePlayerConfig, onTap: () => void): void {
    const { designWidth, designHeight } = config;
    this.designWidth = designWidth;
    const box = new Container();
    box.x = 40;
    box.y = designHeight - 220;
    box.visible = false;

    const bg = new Graphics();
    bg.rect(0, 0, designWidth - 80, 180).fill({ color: 0x000000, alpha: 0.75 });
    box.addChild(bg);
    box.interactive = true;
    box.cursor = "pointer";
    box.on("pointertap", onTap);

    this.speakerText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 22, fill: 0xffd166, fontWeight: "bold" })
    });
    this.speakerText.x = 16;
    this.speakerText.y = 12;
    box.addChild(this.speakerText);

    this.lineText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 24, fill: 0xffffff, wordWrap: true, wordWrapWidth: designWidth - 220 })
    });
    this.lineText.x = 16;
    this.lineText.y = 48;
    box.addChild(this.lineText);

    this.advanceHint = new Text({
      text: "▸ اضغط للمتابعة",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 16, fill: 0x9aa0a6 })
    });
    this.advanceHint.anchor.set(1, 1);
    this.advanceHint.x = designWidth - 96;
    this.advanceHint.y = 168;
    box.addChild(this.advanceHint);

    this.container.addChild(box);
    this.box = box;
  }

  /**
   * Displays one line: speaker name, text, and plays its voice-over audio
   * if it has one. Works identically no matter which scene or story this
   * line came from — no assumption about position in a sequence.
   *
   * Returns whether a voice-over actually started. The caller uses that to
   * pace the story: a line with a real voice ends when the voice ends,
   * which is the only exact timing available: anything else is a guess.
   * A missing or unloaded clip must not read as "started", or the story
   * would wait forever for an `onComplete` that can never fire.
   */
  showLine(
    speaker: string | undefined,
    text: string | undefined,
    audioAlias?: string,
    onVoiceEnd?: () => void
  ): boolean {
    if (this.speakerText) this.speakerText.text = speaker ?? "";
    if (this.lineText) this.lineText.text = text ?? "";
    // A plain line never keeps buttons from a previous choice on screen.
    this.clearChoices();

    if (!audioAlias) return false;
    const id = this.audio.play(audioAlias, {
      channel: "voice",
      volume: 0.8,
      onComplete: onVoiceEnd
    });
    return id !== 0;
  }

  /**
   * Replaces "tap to continue" with one button per choice.
   *
   * While choices are on screen the box itself stops advancing the
   * dialogue: with a decision pending, a stray tap anywhere must not
   * silently pick the default path for the child.
   */
  showChoices(
    choices: Array<{ id: string; label: string }>,
    onChoose: (choiceId: string) => void,
    options: { pressable?: boolean; hint?: string } = {}
  ): void {
    this.clearChoices();
    if (!this.box || choices.length === 0) return;
    // A button that looks pressable but is refused is worse than no button
    // (v1.0.9 §13 rule 3), so when the story does not accept taps the
    // buttons are dimmed and the box says what to do instead.
    const pressable = options.pressable !== false;

    this.box.interactive = false;
    this.box.cursor = "default";
    if (this.advanceHint) this.advanceHint.visible = false;

    const layer = new Container();
    const buttonWidth = Math.min(420, (this.designWidth - 160) / choices.length);
    const gap = 16;
    const totalWidth = choices.length * buttonWidth + (choices.length - 1) * gap;
    let x = (this.designWidth - 80 - totalWidth) / 2;

    for (const choice of choices) {
      const button = new Container();
      button.x = x;
      button.y = 104;

      const bg = new Graphics();
      bg.roundRect(0, 0, buttonWidth, 56, 10)
        .fill({ color: 0xffd166 })
        .stroke({ color: 0xffffff, width: 2 });
      button.addChild(bg);

      const label = new Text({
        text: choice.label,
        style: new TextStyle({
          fontFamily: "Arial",
          fontSize: 22,
          fill: 0x1b2036,
          fontWeight: "bold",
          wordWrap: true,
          wordWrapWidth: buttonWidth - 24,
          align: "center"
        })
      });
      label.anchor.set(0.5);
      label.x = buttonWidth / 2;
      label.y = 28;
      button.addChild(label);

      button.alpha = pressable ? 1 : 0.55;
      button.interactive = pressable;
      button.cursor = pressable ? "pointer" : "default";
      button.on("pointertap", () => {
        // Dismiss immediately: a second tap while the scene transition is
        // still in flight would fire a second choice.
        this.clearChoices();
        onChoose(choice.id);
      });

      layer.addChild(button);
      x += buttonWidth + gap;
    }

    if (options.hint) {
      const hint = new Text({
        text: options.hint,
        style: new TextStyle({ fontFamily: "Arial", fontSize: 17, fill: 0xffd166 })
      });
      hint.anchor.set(0.5, 0);
      hint.x = (this.designWidth - 80) / 2;
      hint.y = 168;
      layer.addChild(hint);
    }

    this.box.addChild(layer);
    this.choiceLayer = layer;
  }

  /** Dismisses the branch buttons from outside — the scene does this the
   *  instant a choice is honoured, so a second intent arriving during the
   *  transition finds nothing to press (v1.0.8 §7.2 rule 2). */
  clearChoiceButtons(): void {
    this.clearChoices();
  }

  /** True while the child still has a decision to make. */
  get hasChoices(): boolean {
    return this.choiceLayer !== null;
  }

  private clearChoices(): void {
    if (this.choiceLayer) {
      this.choiceLayer.destroy({ children: true });
      this.choiceLayer = null;
    }
    if (this.box) {
      this.box.interactive = true;
      this.box.cursor = "pointer";
    }
    if (this.advanceHint) this.advanceHint.visible = true;
  }

  show(): void {
    if (this.box) this.box.visible = true;
  }

  hide(): void {
    if (this.box) this.box.visible = false;
  }

  get isVisible(): boolean {
    return this.box?.visible ?? false;
  }

  destroy(): void {
    this.choiceLayer = null; // owned by box — destroyed with it below
    this.box?.destroy({ children: true });
    this.box = null;
    this.speakerText = null;
    this.lineText = null;
    this.advanceHint = null;
  }
}
