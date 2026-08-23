/**
 * core/audio/AudioManager.ts
 *
 * Wraps the HTML5 Audio API (no third-party dep). Responsible ONLY for:
 *   - loading audio clips (caching the decoded AudioBuffer when possible)
 *   - playing / stopping clips
 *   - per-channel volume control
 *
 * No story logic, no gameplay references.
 */

import type { AudioChannel, AudioPlayOptions } from "@shared/types";
import { Logger } from "@shared/utils";
import { EngineEvents } from "@core/events/EngineEvents";
import type { EventBus } from "@core/events/EventBus";

interface PlayingHandle {
  id: number;
  channel: AudioChannel;
  source: AudioBufferSourceNode | HTMLAudioElement;
  gain: GainNode | null;
  stop: () => void;
}

const DEFAULT_VOLUMES: Record<AudioChannel, number> = {
  sfx: 1,
  music: 0.7,
  voice: 1
};

export class AudioManager {
  private readonly logger = new Logger("AudioManager");
  private readonly eventBus: EventBus;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly channels = new Map<AudioChannel, GainNode>();
  private readonly clips = new Map<string, AudioBuffer>();
  /** URL-keyed fallback cache for browsers without AudioContext decoding. */
  private readonly urlCache = new Map<string, string>();

  private readonly playing = new Map<number, PlayingHandle>();
  private nextId = 1;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /** Lazily create the AudioContext on first user gesture. */
  public async initialize(): Promise<void> {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      this.logger.warn("AudioContext not available — audio will fall back to <audio> elements.");
      return;
    }
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    for (const ch of ["sfx", "music", "voice"] as AudioChannel[]) {
      const gain = this.ctx.createGain();
      gain.gain.value = DEFAULT_VOLUMES[ch];
      gain.connect(this.master);
      this.channels.set(ch, gain);
    }

    this.logger.debug("AudioManager initialized.");
  }

  /** Load (and decode, when possible) an audio clip into the cache. */
  public async load(alias: string, url: string): Promise<void> {
    this.urlCache.set(alias, url);
    if (!this.ctx) {
      // Decoding unavailable — we'll just play from URL at runtime.
      return;
    }
    try {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr);
      this.clips.set(alias, buf);
      this.logger.debug(`Loaded audio "${alias}".`);
    } catch (err) {
      this.logger.error(`Failed to load audio "${alias}" from ${url}:`, err);
      throw err;
    }
  }

  /**
   * How long a loaded clip runs, in seconds — or null if that cannot be
   * known (v1.0.14 §4).
   *
   * Costs nothing to ask: decodeAudioData already produced the buffer at
   * load time, and `duration` is a property of it. Null when the clip was
   * never loaded, or when there is no AudioContext at all and playback
   * falls back to a plain URL — in which case the length is genuinely
   * unknown, and the caller must carry on without it rather than guess.
   */
  public getDuration(alias: string): number | null {
    const buffer = this.clips.get(alias);
    if (!buffer) return null;
    return Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : null;
  }

  /** Play a previously-loaded clip by alias. Returns a handle id (0 on failure). */
  public play(alias: string, options: AudioPlayOptions = {}): number {
    const channel: AudioChannel = options.channel ?? "sfx";
    const volume = options.volume ?? 1;
    const loop = options.loop ?? false;
    const speed = options.speed ?? 1;

    const id = this.nextId++;
    const url = this.urlCache.get(alias);
    const buf = this.clips.get(alias);

    if (this.ctx && this.master && buf) {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.playbackRate.value = speed;

      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain);
      const channelGain = this.channels.get(channel) ?? this.master;
      gain.connect(channelGain);

      src.start();
      const handle: PlayingHandle = {
        id,
        channel,
        source: src,
        gain,
        stop: () => {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
        }
      };
      src.onended = () => {
        this.playing.delete(id);
        options.onComplete?.();
      };
      this.playing.set(id, handle);
      this.eventBus.emit(EngineEvents.Audio.Played, { id, alias, channel });
      return id;
    }

    // Fallback: HTMLAudioElement
    if (url) {
      const el = new Audio(url);
      el.loop = loop;
      el.volume = volume * DEFAULT_VOLUMES[channel];
      el.playbackRate = speed;
      void el.play().catch((err) => this.logger.error(`Failed to play "${alias}":`, err));
      const handle: PlayingHandle = {
        id,
        channel,
        source: el,
        gain: null,
        stop: () => {
          el.pause();
          el.src = "";
        }
      };
      el.onended = () => {
        this.playing.delete(id);
        options.onComplete?.();
      };
      this.playing.set(id, handle);
      this.eventBus.emit(EngineEvents.Audio.Played, { id, alias, channel });
      return id;
    }

    this.logger.warn(`Audio "${alias}" not loaded.`);
    return 0;
  }

  /** Stop a specific playing handle. */
  public stop(id: number): void {
    const handle = this.playing.get(id);
    if (!handle) return;
    handle.stop();
    this.playing.delete(id);
    this.eventBus.emit(EngineEvents.Audio.Stopped, { id });
  }

  /** Stop every playing sound on a channel (or every channel when omitted). */
  public stopAll(channel?: AudioChannel): void {
    for (const [id, handle] of Array.from(this.playing)) {
      if (channel && handle.channel !== channel) continue;
      handle.stop();
      this.playing.delete(id);
      this.eventBus.emit(EngineEvents.Audio.Stopped, { id });
    }
  }

  /** Set the volume of a channel (0..1). */
  public setVolume(channel: AudioChannel, volume: number): void {
    const gain = this.channels.get(channel);
    if (!gain) {
      this.logger.warn(`Unknown channel: ${channel}`);
      return;
    }
    const clamped = Math.max(0, Math.min(1, volume));
    gain.gain.value = clamped;
    this.eventBus.emit(EngineEvents.Audio.VolumeChanged, { channel, volume: clamped });
  }

  /** Get the current volume of a channel. */
  public getVolume(channel: AudioChannel): number {
    return this.channels.get(channel)?.gain.value ?? DEFAULT_VOLUMES[channel];
  }

  /** Suspend the AudioContext (used on tab blur). */
  public suspend(): void {
    void this.ctx?.suspend();
  }

  /** Resume the AudioContext (used on tab focus). */
  public async resume(): Promise<void> {
    await this.ctx?.resume();
  }

  /** Tear down — stops everything and releases the AudioContext. */
  public async destroy(): Promise<void> {
    this.stopAll();
    this.clips.clear();
    this.urlCache.clear();
    if (this.ctx) {
      await this.ctx.close();
      this.ctx = null;
      this.master = null;
      this.channels.clear();
    }
    this.logger.debug("AudioManager destroyed.");
  }
}
