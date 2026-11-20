(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const width = 360;
  const height = 168;
  const fullTurn = 2 * Math.PI;
  const ease = value => value * value * (3 - 2 * value);
  const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function math(ctx, phase, _, terms) {
    const start = 30, unit = 146, top = 56, axis = 114;
    const end = start + 2 * unit;
    const visible = 1 + (terms - 1) * ease(phase);
    for (let i = 0; i < Math.min(terms, 8); i++) {
      const x = start + (2 - 2 ** (1 - i)) * unit;
      const block = unit * 2 ** -i;
      const filled = block * clamp(visible - i, 0, 1);
      if (filled === 0) break;

      const blue = ctx.createLinearGradient(0, top, 0, axis);
      blue.addColorStop(0, `rgba(73,132,202,${0.22 + i * 0.05})`);
      blue.addColorStop(1, `rgba(43,91,168,${0.53 + i * 0.04})`);
      ctx.fillStyle = blue;
      ctx.strokeStyle = '#2b5ba8';
      ctx.lineWidth = 0.9;
      ctx.fillRect(x, top, filled, axis - top);
      ctx.strokeRect(x, top, filled, axis - top);
      if (filled > 26) {
        ctx.fillStyle = '#173965';
        ctx.font = '600 13px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(['1', '½', '¼'][i], x + filled / 2, top + 33);
      }
    }

    ctx.strokeStyle = '#294b77';
    ctx.lineWidth = 1;
    line(ctx, start - 7, axis, end + 8, axis);
    for (const [x, value] of [[start, '0'], [start + unit, '1'], [end, '2']]) {
      line(ctx, x, axis - 3, x, axis + 5);
      ctx.fillStyle = '#365374';
      ctx.font = '600 12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(value, x, axis + 21);
    }
    ctx.strokeStyle = '#c63a2c';
    ctx.setLineDash([3, 4]);
    line(ctx, end, top - 15, end, axis - 1);
    ctx.setLineDash([]);
  }

  function physics(ctx, phase, probe) {
    const slit = 88, screen = 310;
    const upper = 59, lower = 109, centre = 84;
    const screenTop = 15, screenBottom = 153;
    const wavelength = 7.8;

    ctx.save();
    ctx.beginPath();
    ctx.rect(slit, 0, screen - slit, height);
    ctx.clip();
    for (const [y, color] of [[upper, 'rgba(14,113,102,.22)'], [lower, 'rgba(43,91,168,.19)']]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (let radius = 3 + phase * 2 * wavelength; radius < 250; radius += 2 * wavelength) {
        ctx.beginPath();
        ctx.arc(slit, y, radius, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
      }
    }
    ctx.restore();

    ctx.strokeStyle = '#526d74';
    ctx.lineWidth = 1.35;
    for (const [start, end] of [[26, upper - 3], [upper + 3, lower - 3], [lower + 3, 142]]) {
      line(ctx, slit, start, slit, end);
    }
    ctx.strokeStyle = '#0e7166';
    for (const y of [upper, lower]) line(ctx, 27, y, slit - 7, y);

    // Two coherent waves: the screen brightness follows cos²(π · path difference / λ).
    for (let y = screenTop; y < screenBottom; y++) {
      const distance = screen - slit;
      const difference = Math.hypot(distance, y - upper) - Math.hypot(distance, y - lower);
      const intensity = Math.cos(Math.PI * difference / wavelength) ** 2;
      ctx.fillStyle = `rgba(14,113,102,${0.05 + 0.76 * intensity})`;
      ctx.fillRect(screen, y, 22, 1.05);
    }
    ctx.strokeStyle = '#0e7166';
    ctx.lineWidth = 1;
    ctx.strokeRect(screen, screenTop, 22, screenBottom - screenTop);

    const y = clamp(probe ?? centre, screenTop + 2, screenBottom - 2);
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(14,113,102,.55)';
    line(ctx, slit, upper, screen, y);
    line(ctx, slit, lower, screen, y);
    ctx.setLineDash([]);
    ctx.fillStyle = '#0e7166';
    ctx.beginPath();
    ctx.arc(screen, y, 2.8, 0, fullTurn);
    ctx.fill();
  }

  const before = [[42, 43], [68, 43], [42, 125], [68, 125], [45, 84], [66, 84]];
  const after = [[250, 61], [290, 61], [250, 130], [290, 130], [270, 42], [270, 111]];
  const reactants = [[0, 1], [2, 3], [4, 5]];
  const products = [[0, 4], [1, 4], [2, 5], [3, 5]];

  function molecules(ctx, atoms, bonds) {
    ctx.strokeStyle = '#886742';
    ctx.lineWidth = 1.5;
    for (const [connections, alpha] of bonds) {
      ctx.globalAlpha = alpha;
      for (const [i, j] of connections) line(ctx, ...atoms[i], ...atoms[j]);
    }
    ctx.globalAlpha = 1;

    for (const [index, [x, y]] of atoms.entries()) {
      const oxygen = index >= 4;
      const radius = oxygen ? 12 : 9;
      const fill = ctx.createRadialGradient(x - 3, y - 4, 1, x, y, radius);
      fill.addColorStop(0, oxygen ? '#ffe3ad' : '#fff');
      fill.addColorStop(1, oxygen ? '#e3a45e' : '#f0e0c9');
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#a16a35';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, fullTurn);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#613b1a';
      ctx.font = '700 10px system-ui';
      ctx.fillText(oxygen ? 'O' : 'H', x, y + 3.5);
    }
  }

  function chemistry(ctx, phase) {
    const progress = ease(phase);
    const atoms = before.map(([x, y], index) => [
      x + (after[index][0] - x) * progress,
      y + (after[index][1] - y) * progress + Math.sin(progress * Math.PI) * (index % 2 ? 9 : -9),
    ]);

    ctx.fillStyle = '#a1846e';
    ctx.font = '600 18px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('→', 174, 90);
    ctx.fillStyle = '#6d533c';
    ctx.font = '600 12px system-ui';
    ctx.fillText('2H₂ + O₂', 56, 155);
    ctx.fillText('2H₂O', 270, 155);

    if (phase === 1) molecules(ctx, before, [[reactants, 1]]);
    molecules(ctx, atoms, [[reactants, 1 - progress], [products, progress]]);
  }

  const painters = { math, physics, chemistry };

  function setupCanvas(canvas) {
    const kind = canvas.dataset.concept;
    const paint = painters[kind];
    const surface = canvas.closest('[data-concept-surface]');
    const ctx = canvas.getContext('2d');
    if (!paint || !surface || !ctx) return;

    const button = surface.querySelector('.rise-concept-replay');
    const duration = kind === 'physics' ? 1200 : 1550;
    let terms = 6;
    let phase = 1;
    let probe = null;
    let start = null;
    let playing = false;
    let frame = null;
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

    function draw() {
      ctx.clearRect(0, 0, width, height);
      paint(ctx, phase, probe, terms);
    }

    function tick(time) {
      frame = null;
      if (playing) {
        start ??= time;
        phase = clamp((time - start) / duration, 0, 1);
        playing = phase < 1;
      }
      draw();
      if (playing) queue();
    }

    function queue() {
      if (frame === null) frame = requestAnimationFrame(tick);
    }

    function replay() {
      if (reducedMotion.matches) return;
      start = null;
      playing = true;
      queue();
    }

    surface.addEventListener('pointerenter', event => {
      if (event.pointerType === 'mouse' || event.pointerType === 'pen') replay();
    });
    if (surface.matches('a')) surface.addEventListener('focus', replay);
    button?.addEventListener('click', replay);

    if (kind === 'physics') {
      surface.addEventListener('pointermove', event => {
        if (reducedMotion.matches || event.pointerType !== 'mouse') return;
        const box = canvas.getBoundingClientRect();
        const within = event.clientY >= box.top && event.clientY < box.bottom;
        probe = within ? (event.clientY - box.top) * height / box.height : null;
        queue();
      }, { passive: true });
      surface.addEventListener('pointerleave', () => {
        if (probe === null) return;
        probe = null;
        queue();
      });
    }

    if (kind === 'math') {
      window.addEventListener('rise:series-terms', event => {
        terms = event.detail;
        playing = false;
        phase = 1;
        draw();
      });
    }

    function setMotion() {
      if (button) button.hidden = reducedMotion.matches;
      if (reducedMotion.matches) {
        playing = false;
        phase = 1;
        probe = null;
      }
      draw();
    }

    reducedMotion.addEventListener('change', setMotion);
    setMotion();
  }

  function setupCanvases() {
    document.querySelectorAll('.rise-concept-canvas').forEach(setupCanvas);
  }

  if (document.querySelector('.rise-concept-canvas')) setupCanvases();
  else window.addEventListener('rise:page-rendered', setupCanvases, { once: true });
})();
