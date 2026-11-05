/**
 * HTML5 Canvas 60fps Polar Proximity Radar display.
 */
export class RadarRenderer {
  constructor(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas element is required');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new TypeError('Canvas 2D rendering is not available');
    this.sweepAngle = 0;
    this.animationId = null;
    this.devices = Object.freeze([]);
    this._running = false;
    this._generation = 0;
    this._lastTimestamp = null;
  }

  setDevices(devices) {
    if (!Array.isArray(devices)) throw new TypeError('Radar devices must be an array');
    if (devices.length > 1000) throw new RangeError('Radar supports at most 1000 devices');
    const snapshots = [];
    for (const device of devices) {
      try {
        const { name, distanceMeters } = device;
        const score = device.classification?.category?.score;
        if (typeof name !== 'string' || !Number.isFinite(distanceMeters) || distanceMeters < 0 ||
            !Number.isFinite(score) || score < 0 || score > 100) continue;
        snapshots.push(Object.freeze({
          name: name.slice(0, 256), distanceMeters,
          classification: Object.freeze({ category: Object.freeze({ score }) }),
        }));
      } catch (_) {} // A malformed device must not disable every radar blip.
    }
    this.devices = Object.freeze(snapshots);
    return snapshots.length;
  }

  start() {
    if (this._running) return true;
    if (typeof globalThis.requestAnimationFrame !== 'function' ||
        globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.draw();
      return false;
    }
    this._running = true;
    const generation = ++this._generation;
    this._lastTimestamp = null;
    const render = timestamp => {
      if (!this._running || generation !== this._generation) return;
      this.animationId = null;
      if (Number.isFinite(timestamp)) {
        if (this._lastTimestamp !== null) {
          const elapsed = Math.max(0, Math.min(100, timestamp - this._lastTimestamp));
          this.sweepAngle = (this.sweepAngle + elapsed * 0.0024) % (Math.PI * 2);
        }
        this._lastTimestamp = timestamp;
      }
      try {
        this.draw();
      } catch (error) {
        this.stop();
        throw error;
      }
      if (this._running && generation === this._generation) this.animationId = globalThis.requestAnimationFrame(render);
    };
    try {
      this.draw();
      this.animationId = globalThis.requestAnimationFrame(render);
      return true;
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  stop() {
    this._running = false;
    ++this._generation;
    this._lastTimestamp = null;
    if (this.animationId !== null) {
      globalThis.cancelAnimationFrame?.(this.animationId);
      this.animationId = null;
    }
  }

  draw() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 30 || height <= 30 ||
        ctx.isContextLost?.()) return false;
    const centerX = width / 2;
    const centerY = height / 2;
    const maxRadius = Math.min(centerX, centerY) - 15;

    ctx.clearRect(0, 0, width, height);

    // Background circle
    ctx.fillStyle = '#080d14';
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    ctx.fill();

    // Concentric Rings
    const rings = [0.25, 0.5, 0.75, 1.0];
    ctx.strokeStyle = '#1a3326';
    ctx.lineWidth = 1.5;

    for (const r of rings) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, maxRadius * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(centerX - maxRadius, centerY);
    ctx.lineTo(centerX + maxRadius, centerY);
    ctx.moveTo(centerX, centerY - maxRadius);
    ctx.lineTo(centerX, centerY + maxRadius);
    ctx.stroke();

    // Rotating Radar Sweep
    let grad;
    try {
      grad = ctx.createConicGradient?.(this.sweepAngle, centerX, centerY);
      grad?.addColorStop(0, 'rgba(0, 255, 100, 0.25)');
      grad?.addColorStop(0.15, 'rgba(0, 255, 100, 0.0)');
      grad?.addColorStop(1, 'rgba(0, 255, 100, 0.0)');
    } catch (_) { grad = null; }
    ctx.fillStyle = grad || 'rgba(0, 255, 100, 0.15)';
    ctx.beginPath();
    if (grad) ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    else {
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, maxRadius, this.sweepAngle, this.sweepAngle + 0.4);
      ctx.closePath();
    }
    ctx.fill();

    // Outer border
    ctx.strokeStyle = '#00ff66';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Draw detected devices as radar blips
    for (let i = 0; i < this.devices.length; i++) {
      const dev = this.devices[i];
      const distRatio = Math.min(1.0, Math.max(0.1, dev.distanceMeters / 6.0));
      const angle = (i * (Math.PI * 2) / Math.max(1, this.devices.length)) + 0.5;

      const blipX = centerX + Math.cos(angle) * (distRatio * maxRadius);
      const blipY = centerY + Math.sin(angle) * (distRatio * maxRadius);

      const isCritical = dev.classification.category.score >= 90;
      const isHigh = dev.classification.category.score >= 70;

      ctx.fillStyle = isCritical ? '#ff3344' : (isHigh ? '#ff9900' : '#00ccff');
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;

      ctx.beginPath();
      ctx.arc(blipX, blipY, isCritical ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = '11px sans-serif';
      ctx.fillText(dev.name, blipX + 9, blipY + 3);
    }
    return true;
  }
}
