// Balance model and paint choices within the visible traffic stream. A finite
// set of playable cars means repeats are inevitable in heavy traffic; select
// the least-represented model, and keep the nearest car different when tied.
export function chooseTrafficModel(ids, traffic, distance, random = Math.random) {
  if (!ids.length) throw new Error('At least one traffic model is required');
  const nearby = traffic.filter(t => Math.abs(t.s - distance) <= 220);
  const counts = new Map(ids.map(id => [id, 0]));
  for (const t of nearby) if (counts.has(t.id)) counts.set(t.id, counts.get(t.id) + 1);
  const min = Math.min(...counts.values());
  let options = ids.filter(id => counts.get(id) === min);
  if (options.length > 1 && nearby.length) {
    const nearest = nearby.reduce((a, b) => Math.abs(a.s - distance) <= Math.abs(b.s - distance) ? a : b);
    const notNearest = options.filter(id => id !== nearest.id);
    if (notNearest.length) options = notNearest;
  }
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))];
}

function colorDistance(a, b) {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
export function chooseTrafficPaint(palette, traffic, distance, preferred, random = Math.random) {
  if (!palette.length) throw new Error('At least one traffic color is required');
  const nearColors = traffic.filter(t => Math.abs(t.s - distance) <= 150 && Number.isInteger(t.paint)).map(t => t.paint);
  const separation = c => nearColors.length ? Math.min(...nearColors.map(other => colorDistance(c, other))) : 442;
  // Keep the saved custom paint when it will not look like an adjacent car.
  if (preferred !== undefined && separation(preferred) >= 105) return preferred;
  const scored = palette.map(color => ({ color, distance: separation(color) }));
  const best = Math.max(...scored.map(c => c.distance));
  const options = scored.filter(c => c.distance >= best * 0.85);
  return options[Math.min(options.length - 1, Math.floor(random() * options.length))].color;
}
