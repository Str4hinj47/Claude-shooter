import { useEffect, useLayoutEffect, useRef } from "react";
import { type Paths, setupSvgRenderer } from "@left4code/svg-renderer";
import { twMerge } from "tailwind-merge";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const pathsCache = new Map<string, Paths>();

export function parsePaths(json: string): Paths {
  const cached = pathsCache.get(json);
  if (cached) return cached;
  if (pathsCache.size > 200) pathsCache.clear();
  const parsed = JSON.parse(json) as Paths;
  pathsCache.set(json, parsed);
  return parsed;
}

/**
 * Responsive SVG vector frame powered by @left4code/svg-renderer (from cosmic-ui).
 * Redraws crisp geometric chamfers and accent underlines to match the element's live box.
 */
export function VectorFrame({
  className,
  paths,
  enableBackdropBlur,
  enableViewBox,
  ...props
}: {
  paths: Paths;
  enableBackdropBlur?: boolean;
  enableViewBox?: boolean;
} & React.ComponentProps<"svg">) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useIsoLayoutEffect(() => {
    const el = svgRef.current;
    if (!el || !el.parentElement) return;
    const instance = setupSvgRenderer({
      el,
      paths,
      enableBackdropBlur,
      enableViewBox,
    });
    return () => instance.destroy();
  }, [paths, enableBackdropBlur, enableViewBox]);

  return (
    <svg
      {...props}
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      className={twMerge("pointer-events-none absolute inset-0 size-full", className)}
    />
  );
}

const CHAMFER_ACTION_PATHS = parsePaths(
  '[{"show":true,"style":{"strokeWidth":"1","stroke":"var(--frame-stroke)","fill":"var(--frame-fill)"},"path":[["M","14","0"],["L","100% - 6","0"],["L","100% + 0","8"],["L","100% - 14","100% - 5"],["L","4","100% - 5"],["L","0","100% - 13"],["L","14","0"]]},{"show":true,"style":{"strokeWidth":"1","stroke":"var(--frame-accent)","fill":"var(--frame-accent)"},"path":[["M","10","100% - 5"],["L","100% - 20","100% - 5"],["L","100% - 23","100% + 0"],["L","12","100% + 0"],["L","10","100% - 5"]]}]'
);

const CHAMFER_TAB_PATHS = parsePaths(
  '[{"show":true,"style":{"strokeWidth":"1","stroke":"var(--frame-stroke)","fill":"var(--frame-fill)"},"path":[["M","12","0"],["L","100% + 0","0"],["L","100% - 12","100% + 0"],["L","0","100% + 0"],["L","12","0"]]}]'
);

const DOSSIER_FRAME_PATHS = parsePaths(
  '[{"show":true,"style":{"strokeWidth":"1","stroke":"var(--frame-stroke)","fill":"var(--frame-fill)"},"path":[["M","24","4"],["L","100% - 16","4"],["L","100% + 0","20"],["L","100% + 0","100% - 18"],["L","100% - 18","100% - 4"],["L","12","100% - 4"],["L","0","100% - 16"],["L","0","24"],["L","24","4"]]},{"show":true,"style":{"strokeWidth":"1.5","stroke":"var(--frame-accent)","fill":"var(--frame-accent)"},"path":[["M","12","4"],["L","20","4"],["L","4","20"],["L","4","12"],["L","12","4"]]}]'
);

export type TacticalTone = "signal" | "gold" | "ice" | "emerald" | "ghost";

const TONE_VARS: Record<TacticalTone, string> = {
  signal:
    "[--frame-stroke:#ff3b30] [--frame-fill:rgba(255,59,48,0.16)] [--frame-accent:#ff3b30] text-[#f2efe9] hover:[--frame-fill:rgba(255,59,48,0.32)]",
  gold:
    "[--frame-stroke:#e5a93c] [--frame-fill:rgba(229,169,60,0.16)] [--frame-accent:#e5a93c] text-[#f2efe9] hover:[--frame-fill:rgba(229,169,60,0.30)]",
  ice:
    "[--frame-stroke:#38bdf8] [--frame-fill:rgba(56,189,248,0.14)] [--frame-accent:#38bdf8] text-[#e0f2fe] hover:[--frame-fill:rgba(56,189,248,0.28)]",
  emerald:
    "[--frame-stroke:#2dd4bf] [--frame-fill:rgba(45,212,191,0.14)] [--frame-accent:#2dd4bf] text-[#ccfbf1] hover:[--frame-fill:rgba(45,212,191,0.28)]",
  ghost:
    "[--frame-stroke:rgba(242,239,233,0.22)] [--frame-fill:rgba(15,17,24,0.72)] [--frame-accent:rgba(242,239,233,0.45)] text-[#f2efe9] hover:[--frame-stroke:rgba(242,239,233,0.55)] hover:[--frame-fill:rgba(242,239,233,0.08)]",
};

export function TacticalButton({
  tone = "signal",
  shape = "action",
  className,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> & {
  tone?: TacticalTone;
  shape?: "action" | "tab";
}) {
  return (
    <button
      {...props}
      disabled={disabled}
      className={twMerge(
        "group relative inline-flex cursor-pointer items-center justify-center px-6 py-2.5 pb-3.5 text-xs font-bold uppercase tracking-[0.2em] transition-all outline-none disabled:cursor-not-allowed disabled:opacity-40",
        TONE_VARS[tone],
        shape === "tab" && "px-5 py-2 pb-2",
        className
      )}
    >
      <VectorFrame paths={shape === "tab" ? CHAMFER_TAB_PATHS : CHAMFER_ACTION_PATHS} />
      <span className="relative z-10 flex items-center gap-2.5">{children}</span>
    </button>
  );
}

export function DossierShell({
  tone = "ghost",
  className,
  children,
}: {
  tone?: TacticalTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={twMerge(
        "relative px-6 py-5",
        tone === "signal"
          ? "[--frame-stroke:rgba(255,59,48,0.55)] [--frame-fill:rgba(12,10,12,0.86)] [--frame-accent:#ff3b30]"
          : tone === "ice"
            ? "[--frame-stroke:rgba(56,189,248,0.55)] [--frame-fill:rgba(9,14,20,0.86)] [--frame-accent:#38bdf8]"
            : tone === "gold"
              ? "[--frame-stroke:rgba(229,169,60,0.55)] [--frame-fill:rgba(14,13,10,0.88)] [--frame-accent:#e5a93c]"
              : "[--frame-stroke:rgba(242,239,233,0.18)] [--frame-fill:rgba(10,12,16,0.86)] [--frame-accent:rgba(242,239,233,0.5)]",
        className
      )}
    >
      <VectorFrame paths={DOSSIER_FRAME_PATHS} />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
