// State transition for the audible relay. The game's visual lamp phase is the
// clock; this only reports edges and never starts an independent timer.
export function signalAudioTransition(previousSide, previousLit, side, lit, active) {
  if (!active) return { side: null, lit: false, click: null };
  const nextLit = !!side && !!lit;
  const edge = !!side && (side !== previousSide ? nextLit : nextLit !== previousLit);
  return { side, lit: nextLit, click: edge ? (nextLit ? 'on' : 'off') : null };
}
