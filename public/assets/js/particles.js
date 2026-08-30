// 界面背景粒子层：单粒子 + 多边形漂浮，近距离自动吸附连线，不规则游走，鼠标靠近散开。
// 纯 canvas 绘制，pointer-events: none，不影响任何交互；prefers-reduced-motion 时不启用。
(function () {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const CONFIG = {
    dotCount: 46,
    polyCount: 12,
    linkDistance: 120,
    linkOpacity: 0.15,
    attractDistance: 90,
    attractForce: 0.0016,
    mouseRadius: 130,
    mouseForce: 0.55,
    maxSpeed: 0.9,
    palette: ['#3b82c4', '#5e9bd6', '#7c6fd0', '#49b8a8', '#9a7fd1', '#d67fb0']
  };

  const canvas = document.createElement('canvas');
  canvas.className = 'particle-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let width = window.innerWidth;
  let height = window.innerHeight;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  const rand = (min, max) => min + Math.random() * (max - min);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const POLY_SIDES = [3, 4, 6];

  function baseState() {
    return {
      x: rand(0, width),
      y: rand(0, height),
      vx: rand(-0.22, 0.22),
      vy: rand(-0.22, 0.22),
      phase: rand(0, Math.PI * 2),
      wobble: rand(0.004, 0.011),
      color: pick(CONFIG.palette)
    };
  }

  const dots = Array.from({ length: CONFIG.dotCount }, () => ({
    ...baseState(),
    r: rand(1.2, 2.6),
    alpha: rand(0.28, 0.6)
  }));

  const polys = Array.from({ length: CONFIG.polyCount }, () => ({
    ...baseState(),
    vx: rand(-0.14, 0.14),
    vy: rand(-0.14, 0.14),
    size: rand(8, 17),
    sides: pick(POLY_SIDES),
    rot: rand(0, Math.PI * 2),
    spin: rand(-0.004, 0.004),
    alpha: rand(0.2, 0.38)
  }));

  const mouse = { x: -9999, y: -9999 };
  window.addEventListener('mousemove', event => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
  }, { passive: true });
  window.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });

  function wander(p) {
    p.phase += p.wobble;
    p.vx += Math.sin(p.phase) * 0.005;
    p.vy += Math.cos(p.phase * 0.93) * 0.005;
  }

  function scatterFromMouse(p) {
    const dx = p.x - mouse.x;
    const dy = p.y - mouse.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 0.01 && dist < CONFIG.mouseRadius) {
      const force = (1 - dist / CONFIG.mouseRadius) * CONFIG.mouseForce;
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
    }
  }

  function capSpeed(p) {
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > CONFIG.maxSpeed) {
      p.vx = (p.vx / speed) * CONFIG.maxSpeed;
      p.vy = (p.vy / speed) * CONFIG.maxSpeed;
    }
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < -30) p.x = width + 30;
    if (p.x > width + 30) p.x = -30;
    if (p.y < -30) p.y = height + 30;
    if (p.y > height + 30) p.y = -30;
  }

  function drawPolygon(p) {
    ctx.beginPath();
    for (let i = 0; i < p.sides; i += 1) {
      const angle = p.rot + (i / p.sides) * Math.PI * 2;
      const px = p.x + Math.cos(angle) * p.size;
      const py = p.y + Math.sin(angle) * p.size;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = p.alpha;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.globalAlpha = p.alpha * 0.14;
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function frame() {
    ctx.clearRect(0, 0, width, height);

    // 吸附连线
    ctx.lineWidth = 1;
    for (let i = 0; i < dots.length; i += 1) {
      for (let j = i + 1; j < dots.length; j += 1) {
        const a = dots[i];
        const b = dots[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist >= CONFIG.linkDistance) continue;
        const strength = 1 - dist / CONFIG.linkDistance;
        ctx.strokeStyle = a.color;
        ctx.globalAlpha = strength * CONFIG.linkOpacity;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        // 近距离轻微互吸，形成自然聚簇
        if (dist > 24 && dist < CONFIG.attractDistance) {
          const pull = (1 - dist / CONFIG.attractDistance) * CONFIG.attractForce;
          a.vx += ((b.x - a.x) / dist) * pull;
          a.vy += ((b.y - a.y) / dist) * pull;
          b.vx -= ((b.x - a.x) / dist) * pull;
          b.vy -= ((b.y - a.y) / dist) * pull;
        }
      }
    }
    ctx.globalAlpha = 1;

    for (const dot of dots) {
      wander(dot);
      scatterFromMouse(dot);
      capSpeed(dot);
      ctx.globalAlpha = dot.alpha;
      ctx.fillStyle = dot.color;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const poly of polys) {
      wander(poly);
      scatterFromMouse(poly);
      poly.rot += poly.spin;
      capSpeed(poly);
      drawPolygon(poly);
    }

    ctx.globalAlpha = 1;
  }

  let running = false;
  function loop() {
    if (!running) return;
    frame();
    requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    loop();
  }
  function stop() {
    running = false;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });
  start();

  window.PageParticles = { dots: dots.length, polys: polys.length, canvas };
})();
