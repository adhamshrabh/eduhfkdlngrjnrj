/**
 * app/Bootstrap.ts
 *
 * Composition root. Builds the Engine, wires systems to the EventBus,
 * registers scenes with the SceneManager, optionally connects the ESP32
 * adapter, and finally enters the first scene (MenuScene).
 *
 * Bootstrap is the ONLY file that knows about all layers at once — this is
 * where dependencies are injected. Everything below it talks through
 * abstractions (EventBus / interfaces).
 *
 * Content routing strategy
 * ------------------------
 * The SceneManager constructs scene instances lazily via registered factories.
 * To pass per-navigation content (which story / activity to run) into a
 * freshly-constructed scene, we keep two `pending*` slots in closure scope
 * and the factory reads + clears the slot before returning the instance.
 * This avoids fragile "side-channel" events that race with scene changes.
 */

import { Container } from "pixi.js";
import { Engine, EngineConfig, type EngineConfigData, EventBus, EngineEvents } from "@core";
import { StoryLoader } from "@core/content";
import { ExternalInput } from "@core/input";
import { DialogueSystem, PuzzleSystem, EffectsSystem, UISystem, SaveSystem } from "@systems";
import type { PuzzleHandler } from "@systems";
import { MenuScene, StoryScene, ActivityScene } from "@game/scenes";
import { YaraBedScene } from "@game/scenes/YaraBedScene";
import { ESP32Adapter } from "@hardware";
import type { ESP32ClientOptions } from "@hardware";
import type { StoryDefinition, ActivityDefinition, PuzzleDefinition } from "@shared/types";
import { Logger } from "@shared/utils";

export interface BootstrapOptions {
  /** Host element the Pixi canvas will be appended to. Defaults to #app. */
  host?: HTMLElement;
  /** Optional ESP32 WebSocket URL. When provided, the adapter auto-connects. */
  esp32?: ESP32ClientOptions;
  /** Optional overrides for the engine config. */
  config?: Partial<EngineConfigData>;
}

export interface BootstrappedApp {
  engine: Engine;
  eventBus: EventBus;
  dialogue: DialogueSystem;
  puzzle: PuzzleSystem;
  effects: EffectsSystem;
  ui: UISystem;
  save: SaveSystem;
  esp32: ESP32Adapter | null;
  shutdown(): Promise<void>;
}

export class Bootstrap {
  private readonly logger = new Logger("Bootstrap");

  public async run(options: BootstrapOptions = {}): Promise<BootstrappedApp> {
    this.logger.info("Bootstrapping…");

    // --- Configuration ---------------------------------------------------
    const config = EngineConfig.create({
      name: "Educational Activity Engine",
      version: "1.0.0",
      width: 1280,
      height: 720,
      language: "en-US",
      debug: false,
      ...options.config
    });
    if (config.debug) Logger.setLevel("debug");

    // --- Engine + EventBus ----------------------------------------------
    const eventBus = new EventBus();
    const engine = new Engine(config, eventBus);
    await engine.init({ host: options.host });

    // Devices that are not DOM events — a camera, an RFID reader on an
    // ESP32, a two-button box — reach the story through here. See
    // core/input/ExternalInput.ts for why no transport lives in the engine.
    ExternalInput.attach(eventBus);

    // --- UI overlay (renders on top of every scene) ---------------------
    const overlay = new Container();
    overlay.label = "ui-overlay";
    engine.stage.addChild(overlay);

    // --- Systems ---------------------------------------------------------
    const dialogue = new DialogueSystem(eventBus);
    const puzzle = new PuzzleSystem(eventBus);
    const effects = new EffectsSystem(eventBus, engine.animation);
    const ui = new UISystem(eventBus, overlay);
    const save = new SaveSystem(eventBus);

    // --- Puzzle handlers (concrete logic kept here, not in the engine) --
    puzzle.registerHandler("arithmetic", makeArithmeticHandler());
    puzzle.registerHandler("matching", makeMatchingHandler());
    puzzle.registerHandler("drag-match", makeDragMatchHandler());

    // --- Asset bundles --------------------------------------------------
    // The garden bundle is a code-shipped demo bundle (not from content/).
    engine.assets.registerBundle({
      id: "garden-bundle",
      assets: [
        { alias: "garden-bg",       src: "/assets/images/garden-bg.png" },
        { alias: "ada-portrait",    src: "/assets/images/ada-portrait.png" },
        { alias: "apple",           src: "/assets/images/apple.png" },
        { alias: "butterfly",       src: "/assets/images/butterfly.png" },
        { alias: "number-1",        src: "/assets/images/number-1.png" },
        { alias: "number-2",        src: "/assets/images/number-2.png" },
        { alias: "ada-line-1",      src: "/assets/audio/ada-line-1.wav" },
        { alias: "ada-line-2",      src: "/assets/audio/ada-line-2.wav" },
        { alias: "ada-line-3",      src: "/assets/audio/ada-line-3.wav" },
        { alias: "ada-line-4",      src: "/assets/audio/ada-line-4.wav" },
        { alias: "garden-music",    src: "/assets/audio/garden-music.wav" },
        { alias: "sfx-correct",     src: "/assets/audio/sfx-correct.wav" },
        { alias: "sfx-wrong",       src: "/assets/audio/sfx-wrong.wav" }
      ]
    });

    // --- Discover stories & register their bundles automatically --------
    // Story assets are declared in story.json (no Bootstrap edits per story).
    // The flow:
    //   1. StoryLoader.loadAll() fetches /content/stories/index.json
    //   2. For each story, fetches /content/stories/<id>/story.json
    //   3. We read story.assets[] and register a bundle per story
    //
    // Adding a new story = create a folder + story.json. No code changes.
    const manifests = await StoryLoader.loadAll();
    for (const manifest of manifests) {
      // Resolve any asset this browser stores for the story BEFORE
      // reading its URLs — getAssets() is synchronous, so an unprimed
      // browser-held file would fall back to a disk path that does not
      // exist (nothing ever wrote it there).
      await StoryLoader.primeAssets(manifest.id);
      const assets = StoryLoader.getAssets(manifest.id);
      if (assets.length === 0) continue;

      // Some stories (notably ones scaffolded by the "＋ قصة جديدة" /
      // create-story flow before this fix) never got a `bundle` id
      // written into story.json. Without one, this whole block used to
      // be silently skipped — the story's images/audio were on disk,
      // registered in story.json's `assets`, even selectable in the
      // editor's dropdowns, but NEVER actually loaded into Pixi, so
      // nothing ever rendered no matter what the user picked. Rather
      // than requiring every story.json to be hand-edited, generate a
      // stable bundle id here so any story with assets "just works".
      if (!manifest.story.bundle) {
        manifest.story.bundle = `${manifest.id}-bundle`;
        this.logger.warn(`Story "${manifest.id}" had no "bundle" id in story.json — auto-assigned "${manifest.story.bundle}" so its ${assets.length} asset(s) actually load.`);
      }

      engine.assets.registerBundle({
        id: manifest.story.bundle,
        assets
      });
      this.logger.info(`Registered bundle "${manifest.story.bundle}" for story "${manifest.id}" (${assets.length} assets).`);
    }

    // --- Scenes ----------------------------------------------------------
    // The menu is built from the discovered story manifests (already loaded
    // above when registering bundles — no second fetch needed).
    const menuItems = manifests.map((m) => ({
      id: m.id,                // story folder name (e.g. "yara_story")
      title: m.title,          // human-readable title
      scene: m.story.scene     // which Scene subclass runs it
    }));
    const menu = new MenuScene({ title: config.name, items: menuItems });

    // Per-navigation content slots. The scene factory reads + clears these
    // before returning the instance, so the scene is fully configured by
    // the time `initialize()` is invoked.
    let pendingStory: StoryDefinition | null = null;
    let pendingStoryFolderId: string | null = null;
    let pendingActivity: ActivityDefinition | null = null;

    engine.scenes.register(MenuScene.ID, () => menu);
    engine.scenes.register(StoryScene.ID, () => {
      const scene = new StoryScene();
      if (pendingStory) {
        scene.setStory(pendingStory);
        pendingStory = null;
      }
      return scene;
    });
    engine.scenes.register(ActivityScene.ID, () => {
      const scene = new ActivityScene();
      if (pendingActivity) {
        scene.setActivity(pendingActivity);
        pendingActivity = null;
      }
      return scene;
    });

    // YaraBedScene needs the yara-bundle loaded before enter(). The factory
    // reads pendingStory (set by the content routing handler) and injects
    // it into the scene before returning.
    engine.scenes.register(YaraBedScene.ID, () => {
      const scene = new YaraBedScene();
      if (pendingStory) {
        scene.setStory(pendingStory, pendingStoryFolderId ?? undefined);
        pendingStory = null;
        pendingStoryFolderId = null;
      }
      return scene;
    });

    // --- Content routing: a menu click emits RunRequested with the story
    //     folder id. We load story.json dynamically and route to the scene
    //     declared in the manifest. --------------------------------------
    eventBus.on(EngineEvents.Content.RunRequested, async (payload) => {
      if (!payload || typeof payload !== "object") return;
      const p = payload as { id?: string; scene?: string };
      if (typeof p.id !== "string") return;

      // Load the story manifest from /content/stories/<id>/story.json
      const manifest = await StoryLoader.load(p.id);
      if (!manifest) {
        this.logger.warn(`No story found with id "${p.id}".`);
        return;
      }

      const target = manifest.story.scene;
      pendingStory = manifest.story;
      pendingStoryFolderId = manifest.id;
      pendingActivity = null;

      if (!engine.scenes.has(target)) {
        this.logger.error(`Story "${p.id}" requires scene "${target}" but it's not registered.`);
        return;
      }

      await engine.scenes.changeTo(target);
    });

    // Allow scenes to request a return-to-menu (e.g. a "back" button).
    eventBus.on(EngineEvents.Scene.ChangeRequested, (payload) => {
      if (!payload || typeof payload !== "object") return;
      const id = (payload as { id?: string }).id;
      if (typeof id === "string" && engine.scenes.has(id)) {
        void engine.scenes.changeTo(id);
      }
    });

    // --- Hardware (optional) -------------------------------------------
    let esp32: ESP32Adapter | null = null;
    if (options.esp32) {
      esp32 = new ESP32Adapter(eventBus, options.esp32);
      esp32.connect();
    }

    // --- Enter the menu -------------------------------------------------
    await engine.scenes.changeTo(MenuScene.ID);
    engine.start();

    this.logger.info("Bootstrap complete.");
    return {
      engine,
      eventBus,
      dialogue,
      puzzle,
      effects,
      ui,
      save,
      esp32,
      shutdown: async () => {
        esp32?.disconnect();
        dialogue.destroy();
        puzzle.destroy();
        effects.destroy();
        ui.destroy();
        save.destroy();
        await engine.destroy();
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Built-in puzzle handlers. Concrete gameplay logic lives in the app layer —
// the PuzzleSystem itself stays agnostic of any specific puzzle type.
// ---------------------------------------------------------------------------

function makeArithmeticHandler(): PuzzleHandler {
  return {
    onStart(def: PuzzleDefinition) {
      return def.data;
    },
    onSubmit(def: PuzzleDefinition, input: unknown) {
      const data = def.data as { answer: number };
      const guess = Number(input);
      if (Number.isNaN(guess)) return "pending";
      return guess === data.answer ? "solved" : "failed";
    }
  };
}

function makeMatchingHandler(): PuzzleHandler {
  return {
    onStart(def: PuzzleDefinition) {
      return def.data;
    },
    onSubmit(def: PuzzleDefinition, input: unknown) {
      const data = def.data as { answer: string };
      if (typeof input !== "string") return "pending";
      return input === data.answer ? "solved" : "failed";
    }
  };
}

/**
 * drag-match handler: the scene itself detects whether the dragged object
 * is close enough to the target. It sends { matched: boolean } as the input.
 * This handler simply translates that into a verdict.
 */
function makeDragMatchHandler(): PuzzleHandler {
  return {
    onStart() {
      return { type: "drag-match" };
    },
    onSubmit(_def: PuzzleDefinition, input: unknown) {
      if (input && typeof input === "object" && "matched" in (input as Record<string, unknown>)) {
        const matched = (input as { matched: unknown }).matched;
        return matched === true ? "solved" : "failed";
      }
      return "pending";
    }
  };
}
