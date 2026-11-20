(() => {
  const hero = document.querySelector('.rise-hero');
  if (!hero) return;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const radius = 180;
  const size = radius * 2;
  const radiusSquared = radius ** 2;
  const coreSquared = 48 ** 2;
  const spacing = 24;
  const sampleStep = 4;
  const fadeDuration = 160;
  const style = getComputedStyle(hero);
  const paper = style.backgroundColor;
  const grid = style.getPropertyValue('--grid').trim();

  canvas.className = 'rise-hero-lens';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  canvas.hidden = true;
  hero.prepend(canvas);

  let pointer = null;
  let fadeStart = null;
  let frame = null;

  function requestFrame() {
    if (frame === null) frame = requestAnimationFrame(draw);
  }

  function drawLines(origin, horizontal, strength) {
    // Match the 24px CSS grid, including its -1px background position.
    const firstLine = ((-1 - origin) % spacing + spacing) % spacing + 0.5;
    for (let line = firstLine; line < size; line += spacing) {
      context.moveTo(horizontal ? 0 : line, horizontal ? line : 0);
      for (let sample = sampleStep; sample < size; sample += sampleStep) {
        const x = horizontal ? sample : line;
        const y = horizontal ? line : sample;
        const dx = x - radius;
        const dy = y - radius;
        const distanceSquared = dx * dx + dy * dy;
        // Soften the centre and taper to zero at the edge to join the flat grid.
        const taper = Math.max(0, 1 - distanceSquared / radiusSquared);
        const bend = strength * 1.7 * taper ** 2 / Math.sqrt(1 + distanceSquared / coreSquared);
        context.lineTo(x + dx * bend, y + dy * bend);
      }
      context.lineTo(horizontal ? size : line, horizontal ? line : size);
    }
  }

  function draw(time) {
    frame = null;
    const strength = fadeStart === null ? 1 : Math.max(0, 1 - (time - fadeStart) / fadeDuration);
    if (!pointer || reducedMotion.matches || strength === 0) {
      pointer = null;
      canvas.hidden = true;
      return;
    }

    const bounds = hero.getBoundingClientRect();
    const x = pointer.x - bounds.left;
    const y = pointer.y - bounds.top;
    if (fadeStart === null && (x < 0 || x >= bounds.width || y < 0 || y >= bounds.height)) {
      pointer = null;
      canvas.hidden = true;
      return;
    }

    const left = Math.round(x) - radius;
    const top = Math.round(y) - radius;
    const pixels = Math.round(size * (window.devicePixelRatio || 1));
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }

    const scale = pixels / size;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.fillStyle = paper;
    context.fillRect(0, 0, size, size);
    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.beginPath();
    drawLines(top, true, strength);
    drawLines(left, false, strength);
    context.stroke();

    canvas.style.transform = `translate(${left}px, ${top}px)`;
    canvas.hidden = false;
    if (fadeStart !== null) requestFrame();
  }

  function fadeOut() {
    if (!pointer || fadeStart !== null) return;
    fadeStart = performance.now();
    requestFrame();
  }

  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || reducedMotion.matches) return;
    pointer = { x: event.clientX, y: event.clientY };
    fadeStart = null;
    requestFrame();
  }, { passive: true });
  hero.addEventListener('pointerleave', fadeOut);
  window.addEventListener('blur', fadeOut);
  window.addEventListener('scroll', () => {
    if (pointer) requestFrame();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (pointer) requestFrame();
  });
  reducedMotion.addEventListener('change', () => {
    if (pointer) requestFrame();
  });
})();
