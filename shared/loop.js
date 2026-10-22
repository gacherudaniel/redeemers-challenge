/*
 * Fixed-timestep game loop on requestAnimationFrame. The simulation always advances in
 * equal steps, so a game plays at the same speed on a fast laptop and a slow phone.
 */
(function (root) {
  'use strict';

  /**
   * opts.step(dt)   advance the simulation by dt seconds (called 0+ times per frame)
   * opts.render()   draw the current state (called once per frame)
   * opts.fixedDt    simulation step in seconds (default 1/120)
   */
  function create(opts) {
    const fixedDt = opts.fixedDt || 1 / 120;
    const maxFrame = 0.1; // after a stall, don't try to catch up more than this
    let raf = null;
    let last = 0;
    let acc = 0;
    let running = false;

    function frame(now) {
      if (!running) return;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > maxFrame) dt = maxFrame;
      if (dt < 0) dt = 0;
      acc += dt;
      while (acc >= fixedDt) {
        opts.step(fixedDt);
        acc -= fixedDt;
        if (!running) return;
      }
      opts.render();
      raf = root.requestAnimationFrame(frame);
    }

    return {
      start() {
        if (running) return;
        running = true;
        acc = 0;
        last = root.performance.now();
        raf = root.requestAnimationFrame(frame);
      },
      stop() {
        running = false;
        if (raf !== null) root.cancelAnimationFrame(raf);
        raf = null;
      },
      get running() { return running; },
    };
  }

  root.HubLoop = { create };
})(window);
