/**
 * HTML5 Canvas 60fps Polar Proximity Radar display.
 */
export class RadarRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sweepAngle = 0;
    this.animationId = null;
    this.devices = [];
  }

  setDevices(devices) {
    this.devices = devices;
  }

  start() {
    const render = () => {
      this.draw();
      this.sweepAngle = (this.sweepAngle + 0.04) % (Math.PI * 2);
      this.animationId = requestAnimationFrame(render);
    };
    render();
  }

  stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  draw() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
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
    const grad = ctx.createConicGradient(this.sweepAngle, centerX, centerY);
    grad.addColorStop(0, 'rgba(0, 255, 100, 0.25)');
    grad.addColorStop(0.15, 'rgba(0, 255, 100, 0.0)');
    grad.addColorStop(1, 'rgba(0, 255, 100, 0.0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(centerX, centerY, maxRadius, 0, Math.PI * 2);
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
  }
}
