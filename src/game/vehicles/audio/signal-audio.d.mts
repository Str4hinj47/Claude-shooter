export type SignalSide = 'left' | 'right' | null;
export function signalAudioTransition(previousSide: SignalSide, previousLit: boolean, side: SignalSide, lit: boolean, active: boolean): {
  side: SignalSide;
  lit: boolean;
  click: 'on' | 'off' | null;
};
