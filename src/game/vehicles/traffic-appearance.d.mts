export function chooseTrafficModel<T extends string>(ids: T[], traffic: { s: number; id: string }[], distance: number, random?: () => number): T;
export function chooseTrafficPaint(palette: number[], traffic: { s: number; paint: number }[], distance: number, preferred?: number, random?: () => number): number;
