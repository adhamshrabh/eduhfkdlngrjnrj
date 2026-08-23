/**
 * game/scenes/SpriteRegistry.ts
 *
 * Owns the generic content-id → sprite registry, revealing sprites with
 * their saved (or default) layout applied, and named animation presets.
 *
 * Extracted from the YaraBedScene monolith per
 * system-architecture-redesign.md (section 5) — the last of the four
 * dependencies SceneRuntime coordinates (LayoutApplier, PuzzleRunner,
 * DialoguePlayer, SpriteRegistry). No dialogue or puzzle knowledge here,
 * and no "yara" anywhere — a story's own data supplies every id/alias.
 *
 * Also collapses three near-identical reveal implementations that had
 * accumulated in the monolith (character reveal, line-triggered object
 * reveal, and onSolved reward reveal) into one core method.
 */

import { Container as PixiContainer, Sprite, type Container, type Texture } from "pixi.js";
import type { AssetManager } from "@core/assets/AssetManager";
import type { AnimationManager } from "@core/animation/AnimationManager";
import type { LayoutApplier, LayoutDefaults } from "./LayoutApplier";

const DESIGN_HEIGHT = 1080;

export class SpriteRegistry {
  /** Keyed by content id. Typed as Container rather than Sprite since
   *  v1.0.17: a group is a Container with no texture, and every consumer
   *  of get() needs only the structural EffectTarget shape (x, y, alpha,
   *  rotation, scale) — which Container already satisfies. Sprite extends
   *  Container, so nothing that stored a sprite before changed. */
  private readonly displays = new Map<string, Container>();
  /** The alias each sprite is currently showing, so a repeat swap to the
   *  image already on screen costs nothing. */
  private readonly aliases = new Map<string, string>();

  constructor(
    private readonly container: Container,
    private readonly assets: AssetManager,
    private readonly layout: LayoutApplier,
    private readonly animation: AnimationManager
  ) {}

  get(id: string): Container | undefined {
    return this.displays.get(id);
  }

  /** The sprite under an id, or undefined when the id names a group (or
   *  nothing). Used by the operations that need a texture. */
  getSprite(id: string): Sprite | undefined {
    const display = this.displays.get(id);
    return display instanceof Sprite ? display : undefined;
  }

  /**
   * An empty container that other elements can be revealed into
   * (v1.0.17 §3). It draws nothing itself; its whole job is to be the
   * parent whose transform its members inherit.
   */
  revealGroup(id: string): Container {
    const group = new PixiContainer();
    group.sortableChildren = true;   // a member's zIndex sorts it WITHIN the group
    this.layout.apply(group, id, { x: 0, y: 0, scale: 1, anchorX: 0, anchorY: 0 });
    this.container.addChild(group);
    this.register(id, group);
    return group;
  }

  /**
   * Moves an already-revealed display into a group container
   * (v1.0.17 §3).
   *
   * The child's x/y are LEFT ALONE: they are already local coordinates
   * (that is what layout.json holds for a member), and Pixi's addChild
   * detaches from the previous parent for us. Re-deriving them here would
   * be the one thing that moves the artwork.
   */
  moveToGroup(childId: string, groupId: string): boolean {
    const child = this.displays.get(childId);
    const group = this.displays.get(groupId);
    if (!child || !group || child === group) return false;
    group.addChild(child);
    return true;
  }

  /** Store a sprite under a content id, replacing (and destroying) any
   *  previous sprite under the same id. Positioning is EduStudio's job
   *  now — the runtime only draws what layout.json already says. */
  register(id: string, sprite: Container): void {
    const existing = this.displays.get(id);
    if (existing && existing !== sprite) existing.destroy();
    this.displays.set(id, sprite);
  }

  /** Core reveal: loads a texture by alias, applies the id's saved layout
   *  (or the given defaults), fades it in, and registers it. Returns the
   *  sprite, or null if the alias isn't a loaded asset — callers decide
   *  how to handle that (all current callers just silently skip, since a
   *  missing optional reward/character asset shouldn't break a scene). */
  reveal(id: string, alias: string, defaults: LayoutDefaults, fadeToAlpha?: number): Sprite | null {
    if (!this.assets.has(alias)) return null;
    try {
      const tex = this.assets.get<Texture>(alias);
      const sprite = new Sprite(tex);
      this.layout.apply(sprite, id, defaults);
      const targetAlpha = fadeToAlpha ?? (sprite.alpha || 1);
      sprite.alpha = 0;
      this.container.addChild(sprite);
      this.register(id, sprite);
      this.aliases.set(id, alias);
      this.animation.play(`${id}-in`, sprite, {
        alpha: targetAlpha, duration: 0.6, ease: "back.out(1.5)"
      });
      return sprite;
    } catch {
      return null;
    }
  }

  /**
   * Lets an element answer a touch (v1.0.11 §14).
   *
   * Opt-in per element: a sprite with no response is left completely
   * non-interactive, so it cannot swallow a tap meant for the dialogue
   * box or the activity underneath it.
   *
   * `pointertap` only, deliberately. PuzzleRunner tears down by removing
   * EVERY pointermove/pointerup/pointerupoutside listener from the
   * container it was handed; tap is not in that set, so the two cannot
   * interfere (see ActivityPreview's own note on the same hazard).
   *
   * `canRespond` is asked at tap time, not at reveal time — whether the
   * child owes an answer changes during the scene, and a listener wired
   * once cannot know that.
   */
  setTapResponse(id: string, onTap: (() => void) | null, canRespond: () => boolean): void {
    const sprite = this.displays.get(id);
    if (!sprite) return;

    sprite.removeAllListeners("pointertap");
    if (!onTap) {
      sprite.eventMode = "none";
      sprite.cursor = "default";
      return;
    }

    sprite.eventMode = "static";
    sprite.cursor = "pointer";
    sprite.on("pointertap", () => {
      if (!canRespond()) return;
      onTap();
    });
  }

  /**
   * Shows a different image on an element that is already on stage
   * (v1.0.12 §12.6).
   *
   * Swaps the texture on the existing sprite rather than revealing a new
   * one, so position, scale, rotation, anchor and any effect mid-flight
   * all survive: a sheep can start looking frightened without its walk
   * restarting.
   *
   * Deliberately takes the alias directly. An earlier draft rebuilt it
   * from a `character_state` naming rule, which made the engine care how
   * a teacher names her files and failed silently when she named them
   * anything else. Any imported image can replace any element; whether
   * the two are "the same character" is the author's judgement, and one
   * she may deliberately break.
   *
   * An image the story never imported is skipped — the same policy every
   * other decorative failure follows, because a missing face must not
   * stop a story mid-lesson.
   */
  setImage(id: string, alias: string): boolean {
    // getSprite, not get: a group has no texture to swap, and refusing
    // quietly is the right answer rather than throwing mid-scene.
    const sprite = this.getSprite(id);
    if (!sprite) return false;
    if (this.aliases.get(id) === alias) return true;
    if (!this.assets.has(alias)) return false;

    try {
      sprite.texture = this.assets.get<Texture>(alias);
      this.aliases.set(id, alias);
      return true;
    } catch {
      return false;
    }
  }

  /** Show (or replace) a persistent character sprite. */
  showCharacter(id: string, alias: string): void {
    this.reveal(id, alias, { x: 400, y: 800, scale: 0.5, anchorX: 0.5, anchorY: 1.0 });
  }

  /** Show a static object sprite (e.g. a dialogue line revealing an item
   *  mid-scene, via line.showObject). */
  showObject(id: string, alias: string): void {
    this.reveal(id, alias, { x: 700, y: 800, scale: 0.6, anchorX: 0.5, anchorY: 1.0 });
  }

  /**
   * Show one of a scene's `elements[]` — spread across the canvas by
   * index so that multiple elements are each VISIBLE on first placement.
   *
   * This exists because of a real bug: showObject() uses one fixed
   * default position, so every element in a scene that had no saved
   * layout.json entry yet landed at exactly the same coordinates,
   * perfectly stacked. The images all loaded correctly — you just
   * couldn't see any but the topmost, which looked like "only one image
   * shows". Spreading them apart means every element is immediately
   * visible AND separately grabbable in the Layout tab, where dragging
   * it saves a real position that then takes priority over this default
   * forever after (see LayoutApplier.apply — saved always wins).
   *
   * @param index this element's position in the scene's elements[] array
   * @param total how many elements the scene has, so they stay centered
   */
  showSceneElement(id: string, alias: string, index: number, total: number): void {
    const spacing = 300;
    const centerX = 960;
    const startX = centerX - ((total - 1) * spacing) / 2;
    this.reveal(id, alias, {
      x: startX + index * spacing,
      y: 780,
      scale: 0.45,
      anchorX: 0.5,
      anchorY: 1.0
    });
  }

  /** Show an object/character sprite as an activity reward
   *  (onSolved.showObject). Keeps the legacy "doll"/"bed" → alias
   *  shortcut for existing content; any other id is used as its own
   *  alias directly, so any story can define a reward with any id. */
  showReward(objectId: string): void {
    const alias = objectId === "doll" ? "yara-doll" : objectId === "bed" ? "yara-bed" : objectId;
    this.reveal(objectId, alias, { x: 700, y: 800, scale: 0.6, anchorX: 0.5, anchorY: 1.0 }, 1);
  }

  /**
   * Named animation presets an onSolved.animation value can trigger,
   * applied to whatever sprite id is passed in. A story references a
   * preset by name in its own story.json; adding a new preset here makes
   * it available to every story, not just one.
   */
  private readonly animationPresets: Record<string, (sprite: Sprite) => void> = {
    bounceDance: (sprite) => this.runBounceDance(sprite),
    // Alias kept for existing content (yara_story's story.json already
    // uses "bedDance" as the animation name) — same generic implementation.
    bedDance: (sprite) => this.runBounceDance(sprite),
    flyIn: (sprite) => this.runFlyIn(sprite)
  };

  private runBounceDance(sprite: Sprite): void {
    let amplitude = 25;
    const baseY = sprite.y;
    const dance = (): void => {
      if (amplitude < 0.5) { sprite.y = baseY; return; }
      this.animation.play("bounce-dance-up", sprite, {
        y: baseY - amplitude, duration: 0.15, ease: "power1.inOut",
        onComplete: () => {
          this.animation.play("bounce-dance-down", sprite, {
            y: baseY + amplitude, duration: 0.15, ease: "power1.inOut",
            onComplete: () => { amplitude *= 0.85; dance(); }
          });
        }
      });
    };
    dance();
  }

  private runFlyIn(sprite: Sprite): void {
    const startX = sprite.x;
    const startY = sprite.y;
    sprite.x = 2100;
    sprite.y = DESIGN_HEIGHT + 150;
    sprite.alpha = 0;
    this.animation.play("fly-in", sprite, {
      x: startX, y: startY, alpha: 1, duration: 1.4, ease: "power2.out"
    });
    this.animation.play("fly-in-bounce", sprite, {
      y: startY - 40, yoyo: true, repeat: 1, duration: 0.2, delay: 1.4, ease: "power1.inOut"
    });
  }

  /** Runs a named animation preset on a sprite id. Logs clearly (instead
   *  of silently doing nothing) if either the preset name or the sprite
   *  id is unknown — a content author gets real feedback instead of a
   *  reward that just never plays. */
  runAnimationPreset(presetName: string, spriteId: string): void {
    const preset = this.animationPresets[presetName];
    if (!preset) {
      console.warn(`[SpriteRegistry] Unknown animation preset "${presetName}". Available: ${Object.keys(this.animationPresets).join(", ")}`);
      return;
    }
    const sprite = this.getSprite(spriteId);
    if (!sprite) {
      console.warn(`[SpriteRegistry] Animation preset "${presetName}" requested for sprite id "${spriteId}", but no sprite is registered under that id.`);
      return;
    }
    preset(sprite);
  }

  /** Removes a single sprite by id. Safe to call for an id that isn't
   *  registered. */
  remove(id: string): void {
    const sprite = this.displays.get(id);
    if (!sprite) return;
    sprite.destroy();
    this.displays.delete(id);
  }

  /** Destroys every registered sprite and clears the registry — call on
   *  scene teardown. Does not touch the container itself (the scene may
   *  want to remove/keep it independently). */
  clear(): void {
    for (const sprite of this.displays.values()) sprite.destroy();
    this.displays.clear();
    this.aliases.clear();
  }
}
