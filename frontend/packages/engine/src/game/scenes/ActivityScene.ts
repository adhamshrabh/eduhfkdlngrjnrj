/**
 * game/scenes/ActivityScene.ts
 *
 * Runs an educational activity. An activity = a single PuzzleDefinition.
 * The ActivityScene:
 *  - Loads the activity's asset bundle (if any)
 *  - Emits Puzzle.Start when entering so the PuzzleSystem can orchestrate
 *  - Listens for Puzzle.Solved / Puzzle.Failed to update the UI
 *  - Provides a "submit" affordance: for arithmetic puzzles, renders an input
 *    field + submit button; for matching puzzles, renders option buttons.
 *  - Provides a "Back to Menu" button so the user can always navigate away.
 *
 * Communication: in/out exclusively via the EventBus.
 */

import { Text, TextStyle, Container, Graphics } from "pixi.js";
import { Scene } from "@core/scene/Scene";
import { EngineEvents } from "@core/events/EngineEvents";
import type { ActivityDefinition, PuzzleDefinition } from "@shared/types";

interface PuzzleOptionButton {
  id: string;
  container: Container;
}

export class ActivityScene extends Scene {
  public static readonly ID = "ActivityScene";

  private activity: ActivityDefinition | null = null;
  private titleText: Text | null = null;
  private promptText: Text | null = null;
  private statusText: Text | null = null;
  private inputArea: Container | null = null;
  private backButton: Container | null = null;
  private optionButtons: PuzzleOptionButton[] = [];

  /** For arithmetic puzzles: the current numeric input as a string. */
  private currentInput: string = "";

  private readonly onSolved = (): void => {
    if (this.statusText) this.statusText.text = "Solved! 🎉";
  };
  private readonly onFailed = (): void => {
    if (this.statusText) this.statusText.text = "Try again.";
    this.currentInput = "";
    this.refreshInputDisplay();
  };
  private readonly onUIClick = (_payload: unknown): void => {
    // External UI clicks are not currently handled by this scene — the
    // scene's own buttons use Pixi's pointertap directly. This listener
    // exists for future extensibility (e.g. hardware-button events that
    // emit UI.Click with a specific source).
  };

  constructor() {
    super(ActivityScene.ID);
  }

  /** Set the activity to run. Must be called before enter(). */
  public setActivity(activity: ActivityDefinition): void {
    this.activity = activity;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  public async initialize(): Promise<void> {
    if (!this.activity) return;
    if (this.activity.bundle) {
      try {
        await this.assets.loadBundle(this.activity.bundle);
      } catch {
        // Non-fatal.
      }
    }
  }

  public enter(): void {
    const w = this.config.width;
    const h = this.config.height;

    // --- Title ---
    this.titleText = new Text({
      text: this.activity?.title ?? "Activity",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 36, fill: 0xffffff, fontWeight: "bold" })
    });
    this.titleText.anchor.set(0.5);
    this.titleText.x = w / 2;
    this.titleText.y = 60;
    this.root.addChild(this.titleText);

    // --- Prompt ---
    const promptLabel = this.buildPromptLabel();
    this.promptText = new Text({
      text: promptLabel,
      style: new TextStyle({ fontFamily: "Arial", fontSize: 28, fill: 0xeaeaea, wordWrap: true, wordWrapWidth: w - 120 })
    });
    this.promptText.anchor.set(0.5);
    this.promptText.x = w / 2;
    this.promptText.y = h * 0.35;
    this.root.addChild(this.promptText);

    // --- Status ---
    this.statusText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 24, fill: 0xffd166 })
    });
    this.statusText.anchor.set(0.5);
    this.statusText.x = w / 2;
    this.statusText.y = h * 0.75;
    this.root.addChild(this.statusText);

    // --- Input area (puzzle-type-specific) ---
    this.inputArea = new Container();
    this.inputArea.x = w / 2;
    this.inputArea.y = h * 0.55;
    this.root.addChild(this.inputArea);
    this.buildInputArea();

    // --- Back button ---
    this.backButton = this.makeButton("← Menu", 0x2a2f3d, () => {
      this.eventBus.emit(EngineEvents.Scene.ChangeRequested, { id: "MenuScene" });
    });
    this.backButton.x = 24;
    this.backButton.y = 24;
    this.root.addChild(this.backButton);

    // --- Subscribe to puzzle outcome events ---
    this.eventBus.on(EngineEvents.Puzzle.Solved, this.onSolved);
    this.eventBus.on(EngineEvents.Puzzle.Failed, this.onFailed);
    this.eventBus.on(EngineEvents.UI.Click, this.onUIClick);

    // --- Start the puzzle via the bus ---
    if (this.activity) {
      this.eventBus.emit(EngineEvents.Puzzle.Start, this.activity.puzzle);
    }
  }

  public update(_delta: number): void {
    // No per-frame logic by default.
  }

  public exit(): void {
    this.eventBus.off(EngineEvents.Puzzle.Solved, this.onSolved);
    this.eventBus.off(EngineEvents.Puzzle.Failed, this.onFailed);
    this.eventBus.off(EngineEvents.UI.Click, this.onUIClick);
    // Request the puzzle system to reset its state so a fresh puzzle can
    // start cleanly next time.
    if (this.activity) {
      this.eventBus.emit(EngineEvents.Puzzle.Reset, { id: this.activity.puzzle.id });
    }
  }

  public destroy(): void {
    this.titleText?.destroy();
    this.promptText?.destroy();
    this.statusText?.destroy();
    this.inputArea?.destroy({ children: true });
    this.backButton?.destroy({ children: true });
    this.titleText = null;
    this.promptText = null;
    this.statusText = null;
    this.inputArea = null;
    this.backButton = null;
    this.optionButtons = [];
    this.activity = null;
  }

  // -------------------------------------------------------------------------
  // Internals: input area construction per puzzle type
  // -------------------------------------------------------------------------

  private buildPromptLabel(): string {
    if (!this.activity) return "";
    const puzzle = this.activity.puzzle;
    const data = puzzle.data as { prompt?: string };
    return data.prompt ?? this.activity.title;
  }

  private buildInputArea(): void {
    if (!this.activity || !this.inputArea) return;
    const puzzle = this.activity.puzzle;

    if (puzzle.type === "arithmetic") {
      this.buildArithmeticInput(puzzle);
    } else if (puzzle.type === "matching") {
      this.buildMatchingInput(puzzle);
    } else {
      // Unknown type: render a generic submit button that sends null input.
      const btn = this.makeButton("Submit", 0x2563eb, () => {
        this.eventBus.emit(EngineEvents.Puzzle.SubmitRequested, { input: null });
      });
      btn.x = 0;
      btn.y = 0;
      this.inputArea.addChild(btn);
    }
  }

  /** Arithmetic: a numeric display + digit buttons + submit. */
  private buildArithmeticInput(puzzle: PuzzleDefinition): void {
    if (!this.inputArea) return;
    const data = puzzle.data as { operands?: number[]; answer?: number };
    const operands = data.operands ?? [];

    // Numeric input display.
    const inputDisplay = new Text({
      text: "_",
      style: new TextStyle({ fontFamily: "Arial", fontSize: 48, fill: 0xffffff })
    });
    inputDisplay.anchor.set(0.5);
    inputDisplay.y = -60;
    this.inputArea.addChild(inputDisplay);

    // Store reference for refresh.
    (this.inputArea as unknown as { _inputDisplay?: Text })._inputDisplay = inputDisplay;

    // Digit buttons 0-9 in a 5-column grid.
    const cols = 5;
    const btnSize = 56;
    const gap = 8;
    for (let digit = 0; digit <= 9; digit++) {
      const col = digit % cols;
      const row = Math.floor(digit / cols);
      const btn = this.makeButton(String(digit), 0x1f2430, () => {
        this.currentInput += String(digit);
        this.refreshInputDisplay();
      });
      btn.x = (col - (cols - 1) / 2) * (btnSize + gap);
      btn.y = row * (btnSize + gap);
      this.inputArea.addChild(btn);
    }

    // Clear button.
    const clearBtn = this.makeButton("C", 0x7c2d12, () => {
      this.currentInput = "";
      this.refreshInputDisplay();
    });
    clearBtn.x = ((cols - 1) / 2 + 1) * (btnSize + gap);
    clearBtn.y = 0;
    this.inputArea.addChild(clearBtn);

    // Submit button.
    const submitBtn = this.makeButton("✓", 0x166534, () => {
      const value = Number(this.currentInput);
      if (Number.isNaN(value)) return;
      this.eventBus.emit(EngineEvents.Puzzle.SubmitRequested, { input: value });
    });
    submitBtn.x = ((cols - 1) / 2 + 1) * (btnSize + gap);
    submitBtn.y = btnSize + gap;
    this.inputArea.addChild(submitBtn);

    // Render the operands as a label above the input.
    if (operands.length > 0) {
      const opLabel = new Text({
        text: operands.join(" + ") + " = ?",
        style: new TextStyle({ fontFamily: "Arial", fontSize: 32, fill: 0xffffff })
      });
      opLabel.anchor.set(0.5);
      opLabel.y = -120;
      this.inputArea.addChild(opLabel);
    }
  }

  /** Matching: option buttons in a row. */
  private buildMatchingInput(puzzle: PuzzleDefinition): void {
    if (!this.inputArea) return;
    const data = puzzle.data as { options?: string[]; answer?: string };
    const options = data.options ?? [];

    const btnWidth = 140;
    const gap = 16;
    const totalWidth = options.length * btnWidth + (options.length - 1) * gap;
    const startX = -totalWidth / 2 + btnWidth / 2;

    options.forEach((option, i) => {
      const btn = this.makeButton(option, 0x1f2430, () => {
        this.eventBus.emit(EngineEvents.Puzzle.SubmitRequested, { input: option });
      });
      btn.x = startX + i * (btnWidth + gap);
      btn.y = 0;
      this.inputArea!.addChild(btn);
      this.optionButtons.push({ id: option, container: btn });
    });
  }

  private refreshInputDisplay(): void {
    if (!this.inputArea) return;
    const display = (this.inputArea as unknown as { _inputDisplay?: Text })._inputDisplay;
    if (display) {
      display.text = this.currentInput === "" ? "_" : this.currentInput;
    }
  }

  /** Helper: build a labeled button container with a pointer-tap handler. */
  private makeButton(label: string, bgColor: number, onTap: () => void): Container {
    const row = new Container();
    row.interactive = true;
    row.cursor = "pointer";

    const bg = new Graphics();
    const width = Math.max(80, label.length * 18 + 32);
    bg.roundRect(-width / 2, -24, width, 48, 8).fill({ color: bgColor });
    row.addChild(bg);

    const text = new Text({
      text: label,
      style: new TextStyle({ fontFamily: "Arial", fontSize: 22, fill: 0xffffff })
    });
    text.anchor.set(0.5);
    row.addChild(text);

    row.on("pointertap", onTap);
    return row;
  }
}
