/** Acoustic and haptic proximity feedback. No hardware measurements are inferred here. */
export class GeigerEngine {
  constructor(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        ['audioEnabled', 'hapticEnabled'].some(key => options[key] !== undefined && typeof options[key] !== 'boolean')) {
      throw new TypeError('Audio and haptic options must be booleans');
    }
    this.audioEnabled = options.audioEnabled ?? false;
    this.hapticEnabled = options.hapticEnabled ?? true;
    this.audioContext = null;
    this.intervalId = null;
    this.currentFrequencyHz = 0;
    this.currentDistanceMeters = null;
    this.lastError = null;
    this._generation = 0;
    this._resumePromise = null;
    this._suspendPromise = null;
    this._voices = new Set();
    this._hapticActive = false;
  }

  static calculateClickFrequency(distance) {
    if (!Number.isFinite(distance) || distance <= 0) return 0;
    if (distance > 4.5) return 0.5;
    if (distance > 2.5) return 2;
    if (distance > 1.2) return 6;
    if (distance > 0.5) return 15;
    return 30;
  }

  /** Initialize once from a user gesture; unavailable audio leaves haptics usable. */
  initAudio() {
    if (this.audioContext && this.audioContext.state !== 'closed') return this.audioContext;
    const AudioContext = globalThis.window?.AudioContext ?? globalThis.window?.webkitAudioContext;
    if (typeof AudioContext !== 'function') return null;
    try {
      this.audioContext = new AudioContext();
      this.lastError = null;
    } catch (error) {
      this.lastError = error;
      this.audioContext = null;
    }
    return this.audioContext;
  }

  /** Resume failures are handled, and a late permission resolution cannot play after stop. */
  async playClick() {
    const context = this.audioContext;
    const generation = this._generation;
    if (!this.audioEnabled || !context || context.state === 'closed') return false;
    let voice;
    try {
      if (this._suspendPromise) await this._suspendPromise;
      if (generation !== this._generation || !this.audioEnabled || context !== this.audioContext) return false;
      if (context.state !== 'running') {
        if (!this._resumePromise) {
          const resume = Promise.resolve(context.resume()).then(() => true, error => {
            this.lastError = error;
            return false;
          });
          this._resumePromise = resume;
          resume.then(() => { if (this._resumePromise === resume) this._resumePromise = null; });
        }
        if (!await this._resumePromise) return false;
      }
      if (generation !== this._generation || !this.audioEnabled || context !== this.audioContext ||
          context.state !== 'running') return false;

      const osc = context.createOscillator();
      voice = { osc, gain: null };
      const cleanup = () => {
        this._voices.delete(voice);
        try { osc.disconnect(); } catch (_) {}
        try { voice.gain?.disconnect(); } catch (_) {}
      };
      voice.cleanup = cleanup;
      this._voices.add(voice);
      const gain = context.createGain();
      voice.gain = gain;
      osc.onended = cleanup;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1400, context.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, context.currentTime + 0.015);
      gain.gain.setValueAtTime(0.3, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.015);
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.016);
      return true;
    } catch (error) {
      this.lastError = error;
      if (voice) {
        try { voice.osc.stop(); } catch (_) {}
        voice.cleanup?.();
      }
      return false;
    }
  }

  triggerHaptic(durationMs = 20) {
    if (!this.hapticEnabled || !Number.isInteger(durationMs) || durationMs < 0 || durationMs > 1000) return false;
    try {
      const navigator = globalThis.navigator;
      const started = typeof navigator?.vibrate === 'function' ? Boolean(navigator.vibrate(durationMs)) : false;
      if (started) this._hapticActive = durationMs > 0;
      return started;
    } catch (error) {
      this.lastError = error;
      return false;
    }
  }

  updateDistance(distance) {
    const frequency = GeigerEngine.calculateClickFrequency(distance);
    if (frequency === 0) {
      this.stop();
      return;
    }
    this.currentDistanceMeters = distance;
    if (frequency === this.currentFrequencyHz && this.intervalId !== null) return;
    this.currentFrequencyHz = frequency;
    if (this.intervalId !== null) clearInterval(this.intervalId);
    const generation = this._generation;
    this.intervalId = setInterval(() => {
      if (generation !== this._generation) return;
      // playClick handles its own rejected Web Audio operations.
      void this.playClick();
      if (this.currentDistanceMeters !== null && this.currentDistanceMeters < 1) this.triggerHaptic(15);
    }, Math.round(1000 / frequency));
  }

  /** Synchronously silence scheduled voices; the returned, handled promise suspends the context. */
  stop() {
    ++this._generation;
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.intervalId = null;
    this.currentFrequencyHz = 0;
    this.currentDistanceMeters = null;
    for (const voice of [...this._voices]) {
      try { voice.osc.stop(); } catch (_) {}
      voice.cleanup();
    }
    if (this._hapticActive) {
      this._hapticActive = false;
      try { globalThis.navigator?.vibrate?.(0); } catch (_) {}
    }
    const context = this.audioContext;
    if (!context || context.state === 'closed') return Promise.resolve();
    if (this._suspendPromise) return this._suspendPromise;
    const resume = this._resumePromise;
    const suspend = (async () => {
      if (resume) await resume;
      if (context.state !== 'closed' && typeof context.suspend === 'function') await context.suspend();
    })().catch(error => { this.lastError = error; });
    this._suspendPromise = suspend;
    suspend.then(() => { if (this._suspendPromise === suspend) this._suspendPromise = null; });
    return suspend;
  }

  /** Release the reusable context when the owning page/component is disposed. */
  async dispose() {
    await this.stop();
    const context = this.audioContext;
    this.audioContext = null;
    if (context && context.state !== 'closed' && typeof context.close === 'function') {
      try { await context.close(); } catch (error) { this.lastError = error; }
    }
  }
}
