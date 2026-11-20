(() => {
  const hero = document.querySelector('.rise-hero');
  if (!hero) return;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(any-hover: hover) and (any-pointer: fine)');
  const controls = hero.querySelector('.rise-lens-controls');
  const clearButton = hero.querySelector('[data-clear-lens]');
  const radius = 180;
  const radiusSquared = radius ** 2;
  const spacing = 24;
  const sampleStep = 4;
  const fadeDuration = 160;
  const style = getComputedStyle(hero);
  const paper = style.backgroundColor;
  const grid = style.getPropertyValue('--grid').trim();
  const ink = style.getPropertyValue('--vermilion').trim();

  canvas.className = 'rise-hero-lens';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  hero.prepend(canvas);

  let pointer = null;
  let pin = null;
  let fadeStart = null;
  let frame = null;

  function requestFrame() {
    if (frame === null) frame = requestAnimationFrame(draw);
  }

  function pullAt(x, y, centre) {
    if (!centre) return 0;
    const dx = x - centre.x;
    const dy = y - centre.y;
    const taper = Math.max(0, 1 - (dx * dx + dy * dy) / radiusSquared);
    return centre.strength * taper ** 2;
  }

  function drawLines(origin, horizontal, width, height, cursor, fixed) {
    // Match the 24px CSS grid, including its -1px background position.
    const firstLine = ((-1 - origin) % spacing + spacing) % spacing + 0.5;
    const length = horizontal ? width : height;
    const breadth = horizontal ? height : width;
    for (let line = firstLine; line < breadth; line += spacing) {
      context.moveTo(horizontal ? 0 : line, horizontal ? line : 0);
      for (let sample = sampleStep; sample < length; sample += sampleStep) {
        const x = horizontal ? sample : line;
        const y = horizontal ? line : sample;
        const cursorPull = pullAt(x, y, cursor);
        const fixedPull = pullAt(x, y, fixed);
        // Weaken the overlap so the combined displacement does not fold the grid.
        const cursorWeight = cursorPull * (1 - fixedPull / 2);
        const fixedWeight = fixedPull * (1 - cursorPull / 2);
        context.lineTo(
          x - (x - (cursor?.x ?? x)) * cursorWeight - (x - (fixed?.x ?? x)) * fixedWeight,
          y - (y - (cursor?.y ?? y)) * cursorWeight - (y - (fixed?.y ?? y)) * fixedWeight,
        );
      }
      context.lineTo(horizontal ? length : line, horizontal ? line : length);
    }
  }

  function draw(time) {
    frame = null;
    const strength = fadeStart === null ? 1 : Math.max(0, 1 - (time - fadeStart) / fadeDuration);
    if (reducedMotion.matches) {
      canvas.hidden = true;
      return;
    }

    const bounds = hero.getBoundingClientRect();
    let cursor = pointer && strength > 0 ? {
      x: Math.round(pointer.x - bounds.left),
      y: Math.round(pointer.y - bounds.top),
      strength: 0.82 * strength,
    } : null;
    if (cursor && fadeStart === null && (cursor.x < 0 || cursor.x >= bounds.width || cursor.y < 0 || cursor.y >= bounds.height)) cursor = null;
    if (!cursor) pointer = null;
    if (!cursor && !pin) {
      canvas.hidden = true;
      return;
    }

    const first = cursor ?? pin;
    const second = pin ?? first;
    const left = Math.min(first.x, second.x) - radius;
    const top = Math.min(first.y, second.y) - radius;
    let width = Math.abs(first.x - second.x) + 2 * radius;
    let height = Math.abs(first.y - second.y) + 2 * radius;
    if (cursor && pin) {
      // Reuse the bitmap across small pointer moves while both wells are visible.
      width = Math.ceil(width / 48) * 48;
      height = Math.ceil(height / 48) * 48;
    }
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const pixelsWide = Math.round(width * scale);
    const pixelsHigh = Math.round(height * scale);
    if (canvas.width !== pixelsWide || canvas.height !== pixelsHigh) {
      canvas.width = pixelsWide;
      canvas.height = pixelsHigh;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }

    const localCursor = cursor && { ...cursor, x: cursor.x - left, y: cursor.y - top };
    const localPin = pin && { ...pin, x: pin.x - left, y: pin.y - top };
    context.setTransform(pixelsWide / width, 0, 0, pixelsHigh / height, 0, 0);
    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);
    context.strokeStyle = grid;
    context.lineWidth = 1;
    context.beginPath();
    drawLines(top, true, width, height, localCursor, localPin);
    drawLines(left, false, width, height, localCursor, localPin);
    context.stroke();

    if (localPin) {
      context.beginPath();
      context.arc(localPin.x, localPin.y, 3, 0, Math.PI * 2);
      context.fillStyle = ink;
      context.fill();
    }

    canvas.style.transform = `translate(${left}px, ${top}px)`;
    canvas.hidden = false;
    if (cursor && fadeStart !== null) requestFrame();
  }

  function fadeOut() {
    if (!pointer || fadeStart !== null) return;
    fadeStart = performance.now();
    requestFrame();
  }

  function clearPin() {
    if (!pin) return;
    pin = null;
    if (clearButton) clearButton.disabled = true;
    requestFrame();
  }

  function updateControls() {
    const enabled = finePointer.matches && !reducedMotion.matches;
    if (controls) controls.hidden = !enabled;
    if (!enabled) clearPin();
    if (reducedMotion.matches && pointer) {
      pointer = null;
      requestFrame();
    }
  }

  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || reducedMotion.matches) return;
    pointer = { x: event.clientX, y: event.clientY };
    fadeStart = null;
    requestFrame();
  }, { passive: true });
  hero.addEventListener('click', (event) => {
    if (event.pointerType !== 'mouse' || reducedMotion.matches || !finePointer.matches) return;
    if (event.target !== hero && !event.target.matches('.rise-hero-grid, .rise-hero-foot')) return;
    const bounds = hero.getBoundingClientRect();
    pin = { x: Math.round(event.clientX - bounds.left), y: Math.round(event.clientY - bounds.top), strength: 0.74 };
    if (clearButton) clearButton.disabled = false;
    requestFrame();
  });
  clearButton?.addEventListener('click', clearPin);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clearPin();
  });
  hero.addEventListener('pointerleave', fadeOut);
  window.addEventListener('blur', fadeOut);
  window.addEventListener('scroll', () => {
    if (pointer) requestFrame();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (pin && (pin.x >= hero.clientWidth || pin.y >= hero.clientHeight)) clearPin();
    if (pointer || pin) requestFrame();
  });
  reducedMotion.addEventListener('change', updateControls);
  finePointer.addEventListener('change', updateControls);
  updateControls();
})();
