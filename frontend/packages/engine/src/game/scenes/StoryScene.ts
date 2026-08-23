/**
 * game/scenes/StoryScene.ts
 *
 * Runs an educational story. A story = a DialogueScript + optional embedded
 * puzzles + optional asset bundle (images + audio).
 *
 * The scene:
 *  - Loads the story's asset bundle (if any) during initialize()
 *  - Renders a background image (if the bundle provides one)
 *  - Renders the character portrait next to the dialogue box
 *  - Plays voice audio when each line is shown
 *  - Plays background music while the story is active
 *  - Emits Dialogue.StartRequested when entering → DialogueSystem begins
 *  - Subscribes to Dialogue.LineShown to update text + portrait + audio
 *  - Tapping the dialogue box emits Dialogue.Next (input event)
 *  - Provides a "Back to Menu" button so the user can always navigate away
 *
 * Communication: in/out exclusively via the EventBus.
 */

import { Text, TextStyle, Container, Graphics, Sprite, type Texture } from "pixi.js";
import { Scene } from "@core/scene/Scene";
import { EngineEvents } from "@core/events/EngineEvents";
import type { StoryDefinition, DialogueLine } from "@shared/types";

export class StoryScene extends Scene {
  public static readonly ID = "StoryScene";

  private story: StoryDefinition | null = null;
  private backgroundImage: Sprite | null = null;
  private portraitSprite: Sprite | null = null;
  private dialogueBox: Container | null = null;
  private speakerText: Text | null = null;
  private lineText: Text | null = null;
  private advanceHint: Text | null = null;
  private backButton: Container | null = null;
  private currentVoiceId: number | null = null;
  private bgmStarted = false;

  private readonly advanceHandler = (): void => {
    this.eventBus.emit(EngineEvents.Dialogue.Next, {});
  };

  constructor() {
    super(StoryScene.ID);
  }

  /** Set the story to be played. Must be called before `enter()`. */
  public setStory(story: StoryDefinition): void {
    this.story = story;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public async initialize(): Promise<void> {
    if (!this.story) return;
    if (this.story.bundle) {
      try {
        await this.assets.loadBundle(this.story.bundle);
      } catch (err) {
        // Non-fatal: the scene will render without images/audio.
        console.warn(`[StoryScene] Failed to load bundle "${this.story.bundle}":`, err);
      }
    }
  }

  public enter(): void {
    this.buildBackground();
    this.buildDialogueBox();
    this.buildBackButton();

    // Subscribe to dialogue output events to re-render the text.
    this.eventBus.on(EngineEvents.Dialogue.LineShown, this.onLineShown);
    this.eventBus.on(EngineEvents.Dialogue.End, this.onDialogueEnd);

    // Start background music if available.
    if (!this.bgmStarted && this.assets.has("garden-music")) {
      this.audio.load("garden-music", "/assets/audio/garden-music.wav")
        .then(() => {
          this.audio.play("garden-music", { channel: "music", loop: true, volume: 0.3 });
        })
        .catch(() => {});
      this.bgmStarted = true;
    }

    // Start the dialogue via the bus (input event).
    if (this.story) {
      this.eventBus.emit(EngineEvents.Dialogue.StartRequested, this.story.dialogue);
    } else {
      if (this.lineText) this.lineText.text = "(No story loaded.)";
    }
  }

  public update(_delta: number): void {
    // StoryScene has no per-frame animation logic of its own.
  }

  public exit(): void {
    this.eventBus.off(EngineEvents.Dialogue.LineShown, this.onLineShown);
    this.eventBus.off(EngineEvents.Dialogue.End, this.onDialogueEnd);
    // Stop any playing voice.
    if (this.currentVoiceId !== null) {
      this.audio.stop(this.currentVoiceId);
      this.currentVoiceId = null;
    }
    // Stop background music.
    this.audio.stopAll("music");
    // Request the dialogue system to end so its state is cleared.
    if (this.story) {
      this.eventBus.emit(EngineEvents.Dialogue.EndRequested, { id: this.story.dialogue.id });
    }
  }

  public destroy(): void {
    this.dialogueBox?.destroy({ children: true });
    this.backButton?.destroy({ children: true });
    this.portraitSprite?.destroy();
    this.backgroundImage?.destroy();
    this.dialogueBox = null;
    this.backButton = null;
    this.portraitSprite = null;
    this.backgroundImage = null;
    this.speakerText = null;
    this.lineText = null;
    this.advanceHint = null;
    this.story = null;
  }

  // -------------------------------------------------------------------------
  // Internals: visual construction
  // -------------------------------------------------------------------------

  private buildBackground(): void {
    const w = this.config.width;
    const h = this.config.height;
    // Try to load a background image from the asset cache.
    if (this.story?.bundle && this.assets.has("garden-bg")) {
      try {
        const tex = this.assets.get<Texture>("garden-bg");
        const sprite = new Sprite(tex);
        // Scale to fill the screen while preserving aspect ratio.
        const scale = Math.max(w / tex.width, h / tex.height);
        sprite.scale.set(scale);
        sprite.x = (w - tex.width * scale) / 2;
        sprite.y = (h - tex.height * scale) / 2;
        this.root.addChild(sprite);
        this.backgroundImage = sprite;
      } catch {
        // Fall through to solid color.
      }
    }
    if (!this.backgroundImage) {
      const bg = new Graphics();
      bg.rect(0, 0, w, h).fill({ color: 0x1a1f2e });
      this.root.addChild(bg);
    }
  }

  private buildDialogueBox(): void {
    const w = this.config.width;
    const h = this.config.height;

    const box = new Container();
    box.x = 40;
    box.y = h - 220;

    const bg = new Graphics();
    bg.rect(0, 0, w - 80, 180).fill({ color: 0x000000, alpha: 0.75 });
    box.addChild(bg);

    // Make the whole dialogue box clickable to advance the dialogue.
    box.interactive = true;
    box.cursor = "pointer";
    box.on("pointertap", this.advanceHandler);

    this.speakerText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 22, fill: 0xffd166, fontWeight: "bold" })
    });
    this.speakerText.x = 16;
    this.speakerText.y = 12;
    box.addChild(this.speakerText);

    this.lineText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 24, fill: 0xffffff, wordWrap: true, wordWrapWidth: w - 220 })
    });
    this.lineText.x = 16;
    this.lineText.y = 48;
    box.addChild(this.lineText);

    this.advanceHint = new Text({
      text: "▸ tap to continue",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 16, fill: 0x9aa0a6 })
    });
    this.advanceHint.anchor.set(1, 1);
    this.advanceHint.x = w - 96;
    this.advanceHint.y = 168;
    box.addChild(this.advanceHint);

    this.root.addChild(box);
    this.dialogueBox = box;
  }

  private buildBackButton(): void {
    const row = new Container();
    row.x = 24;
    row.y = 24;
    row.interactive = true;
    row.cursor = "pointer";

    const bg = new Graphics();
    bg.roundRect(0, 0, 120, 40, 8).fill({ color: 0x2a2f3d });
    row.addChild(bg);

    const label = new Text({
      text: "← Menu",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 18, fill: 0xffffff })
    });
    label.x = 12;
    label.y = 8;
    row.addChild(label);

    row.on("pointertap", () => {
      this.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id: "MenuScene" });
    });

    this.root.addChild(row);
    this.backButton = row;
  }

  // -------------------------------------------------------------------------
  // Internals: event handlers
  // -------------------------------------------------------------------------

  private readonly onLineShown = (payload: unknown): void => {
    if (!payload || typeof payload !== "object") return;
    const line = (payload as { line?: DialogueLine }).line;
    if (!line) return;

    // Update the speaker + text.
    if (this.speakerText) this.speakerText.text = line.speaker ?? "";
    if (this.lineText) {
      let text = line.text ?? "";
      if (line.choices && Array.isArray(line.choices) && line.choices.length > 0) {
        text += "\n\n";
        const choices = line.choices as Array<{ id: string; label: string }>;
        choices.forEach((c, i) => {
          text += `${i + 1}. ${c.label}\n`;
        });
        text += "(tap a number key to choose)";
      }
      this.lineText.text = text;
    }

    // Update the hint.
    if (this.advanceHint) {
      const hasChoices = line.choices && Array.isArray(line.choices) && line.choices.length > 0;
      this.advanceHint.text = hasChoices ? "▸ press 1-9 to choose" : "▸ tap to continue";
    }

    // Update the portrait.
    this.updatePortrait(line.portrait);

    // Play voice audio.
    this.playVoice(line.audio);
  };

  private readonly onDialogueEnd = (): void => {
    if (this.lineText) this.lineText.text = "(End of story. Tap to return to menu.)";
    if (this.speakerText) this.speakerText.text = "";
    if (this.advanceHint) this.advanceHint.text = "▸ tap to return";
    if (this.portraitSprite) {
      this.portraitSprite.visible = false;
    }
    // Make the dialogue box return to menu on tap after the story ends.
    if (this.dialogueBox) {
      this.dialogueBox.removeAllListeners();
      this.dialogueBox.on("pointertap", () => {
        this.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id: "MenuScene" });
      });
    }
  };

  private updatePortrait(alias?: string): void {
    // Remove the old portrait.
    if (this.portraitSprite) {
      this.portraitSprite.destroy();
      this.portraitSprite = null;
    }
    if (!alias || !this.assets.has(alias)) return;
    try {
      const tex = this.assets.get<Texture>(alias);
      const sprite = new Sprite(tex);
      // Position in the bottom-right of the dialogue box.
      const scale = 140 / Math.max(tex.width, tex.height);
      sprite.scale.set(scale);
      sprite.x = this.config.width - 180;
      sprite.y = this.config.height - 210;
      this.root.addChild(sprite);
      this.portraitSprite = sprite;
    } catch {
      // Asset not available — skip portrait.
    }
  }

  private playVoice(alias?: string): void {
    // Stop any currently-playing voice.
    if (this.currentVoiceId !== null) {
      this.audio.stop(this.currentVoiceId);
      this.currentVoiceId = null;
    }
    if (!alias) return;
    // The asset should already be loaded as part of the bundle. If it isn't
    // in the audio cache, load it on demand from /assets/audio/<alias>.wav.
    if (!this.assets.has(alias)) return;
    const url = `/assets/audio/${alias}.wav`;
    this.audio.load(alias, url)
      .then(() => {
        const id = this.audio.play(alias, { channel: "voice", volume: 0.8 });
        this.currentVoiceId = id;
      })
      .catch(() => {
        // Audio not available — silent.
      });
  }
}
