/*
 * Celebration confetti on the shared #confetti canvas. Skipped for reduced motion.
 */
(function (root) {
  'use strict';

  let run = 0;

  function burst(opts) {
    if (root.HubUtil.reducedMotion()) return;
    const canvas = document.getElementById('confetti');
    const ctx = canvas && canvas.getContext && canvas.getContext('2d');
    if (!ctx) return;
    const id = ++run;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const w = root.innerWidth;
    const h = root.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const colors = ['--gold', '--olive', '--clay', '--gold-soft', '--accent'].map((v) => css.getPropertyValue(v).trim() || '#b88a2c');
    const count = Math.min((opts && opts.count) || 150, Math.round(w / 5));
    const pieces = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.6,
      vx: (Math.random() - 0.5) * 2.4,
      vy: 2 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      size: 6 + Math.random() * 6,
      color: colors[i % colors.length],
    }));
    const started = root.performance.now();
    function frame(now) {
      if (id !== run) return;
      ctx.clearRect(0, 0, w, h);
      let alive = false;
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.035;
        p.rot += p.vr;
        if (p.y < h + 20) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.4 * Math.abs(Math.cos(p.rot)) + 1);
        ctx.restore();
      }
      if (alive && now - started < 5000) root.requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, w, h);
    }
    root.requestAnimationFrame(frame);
  }

  root.HubConfetti = { burst };
})(window);
