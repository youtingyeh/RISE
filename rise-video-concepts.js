(() => {
  const width = 360;
  const height = 168;
  const duration = 1300;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const diagrams = new WeakMap();
  let active = null;
  let frame = null;

  function path(ctx, points, stroke, fill, thickness = 1) {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = thickness;
    ctx.stroke();
  }

  function label(ctx, text, x, y, color, size, weight = 600) {
    ctx.fillStyle = color;
    ctx.font = `${weight} ${size}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  function math(ctx, progress) {
    const left = [131, 100], right = [183, 100], top = [131, 61];
    const stroke = '#2b5ba8';
    const areas = [
      { points: [left, top, [92, 61], [92, 100]], value: '9', label: [111, 81] },
      { points: [left, right, [183, 152], [131, 152]], value: '16', label: [157, 126] },
      { points: [right, top, [170, 9], [222, 48]], value: '25', label: [176, 55] },
    ];
    areas.forEach(({ points, value, label: position }, index) => {
      const emphasis = 1 - Math.min(1, Math.abs(progress * 3 - index - 0.55));
      path(ctx, points, stroke, `rgba(43,91,168,${0.15 + 0.29 * emphasis})`, 1.5);
      label(ctx, value, ...position, '#183861', 15);
    });
    path(ctx, [left, right, top], '#183861', '#f8fbff', 1.8);
    path(ctx, [[131, 90], [141, 90], [141, 100]], stroke);
    label(ctx, 'a² + b² = c²', 270, 77, '#183861', 18);
    label(ctx, '9 + 16 = 25', 270, 101, stroke, 14);
  }

  function physics(ctx, progress) {
    const boundary = 83;
    const centre = 177;
    const incidence = (33 + Math.sin(progress * Math.PI) * 25) * Math.PI / 180;
    const refraction = Math.asin(Math.sin(incidence) / 1.5);
    const incoming = [centre - Math.tan(incidence) * 55, 28];
    const outgoing = [centre + Math.tan(refraction) * 63, 146];
    const contact = [centre, boundary];
    const ink = '#0e7166';
    ctx.fillStyle = '#0e71661a';
    ctx.fillRect(28, boundary, 304, 65);
    path(ctx, [[28, boundary], [332, boundary]], '#2d6c65', null, 1.2);
    ctx.setLineDash([4, 4]);
    path(ctx, [[centre, 17], [centre, 150]], '#698481');
    ctx.setLineDash([]);
    path(ctx, [incoming, contact, outgoing], ink, null, 2.8);
    const leg = progress < 0.5 ? [incoming, contact] : [contact, outgoing];
    const travel = (progress * 2) % 1;
    if (progress < 1) {
      ctx.fillStyle = '#c63a2c';
      ctx.beginPath();
      ctx.arc(leg[0][0] + (leg[1][0] - leg[0][0]) * travel, leg[0][1] + (leg[1][1] - leg[0][1]) * travel, 3.5, 0, 2 * Math.PI);
      ctx.fill();
    }
    label(ctx, '空氣', 293, 58, '#315d57', 13);
    label(ctx, '玻璃', 293, 109, '#315d57', 13);
  }

  const table = [['N', 'O', 'F'], ['P', 'S', 'Cl'], ['As', 'Se', 'Br']];
  function chemistry(ctx, progress) {
    const accent = '#9a5a0e';
    const moving = Math.min(2, Math.floor(progress * 3));
    for (let row = 0; row < table.length; row++) {
      for (let column = 0; column < table[row].length; column++) {
        const x = 96 + column * 56;
        const y = 32 + row * 38;
        const group = column === 1;
        const highlight = group && (row === moving || progress === 1);
        const fill = highlight ? '#f2ca83' : group ? '#f8e5c2' : '#fffbf2';
        path(ctx, [[x, y], [x + 52, y], [x + 52, y + 34], [x, y + 34]], group ? accent : '#cab292', fill, group ? 1.35 : 1);
        label(ctx, table[row][column], x + 26, y + 17, group ? '#5d3511' : '#674d36', group ? 18 : 14);
      }
    }
    for (const [column, number] of [15, 16, 17].entries()) {
      label(ctx, String(number), 122 + column * 56, 19, column === 1 ? accent : '#765c40', 12);
    }
  }

  const painters = { math, physics, chemistry };

  function draw(diagram, progress = 1) {
    const { ctx, paint } = diagram;
    ctx.clearRect(0, 0, width, height);
    paint(ctx, progress);
  }

  function initialize() {
    for (const canvas of document.querySelectorAll('canvas.rise-video-concept')) {
      if (diagrams.has(canvas)) continue;
      const paint = painters[canvas.dataset.videoConcept];
      const ctx = canvas.getContext('2d');
      if (!ctx || !paint) continue;
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      const diagram = { canvas, ctx, paint };
      diagrams.set(canvas, diagram);
      draw(diagram);
    }
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (active?.canvas.isConnected) draw(active);
    active = null;
  }

  function play(link) {
    if (!link || reducedMotion.matches || document.hidden) return;
    const diagram = diagrams.get(link.querySelector('canvas.rise-video-concept'));
    if (!diagram || active === diagram) return;
    stop();
    active = diagram;
    let start;
    function tick(time) {
      if (!diagram.canvas.isConnected) { stop(); return; }
      start ??= time;
      const progress = Math.min(1, (time - start) / duration);
      draw(diagram, progress);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else { frame = null; active = null; }
    }
    frame = requestAnimationFrame(tick);
  }

  document.addEventListener('pointerover', event => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const link = event.target.closest('.video-card > a');
    if (link && !link.contains(event.relatedTarget)) play(link);
  });
  document.addEventListener('focusin', event => play(event.target.closest('.video-card > a')));
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) stop(); });
  window.addEventListener('scroll', () => {
    if (!active) return;
    const bounds = active.canvas.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= innerHeight) stop();
  }, { passive: true });
  window.addEventListener('rise:page-rendered', initialize);
  window.addEventListener('rise:video-cards-rendered', initialize);
  initialize();
})();
