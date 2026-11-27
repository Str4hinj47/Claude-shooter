import { useState } from "react";
import { X, RefreshCw, HeartPulse, Flame, Trophy, Coins, Swords } from "lucide-react";
import type { Game } from "../game/Game";
import type { PitHudBookieInfo } from "../game/city/UndergroundFightPit";

export function FightPitBookieModal({
  info,
  health,
  maxHealth,
  game,
}: {
  info: PitHudBookieInfo;
  health: number;
  maxHealth: number;
  game: Game | null;
}) {
  const [tab, setTab] = useState<"card" | "fight">("card");
  const [selectedMatchId, setSelectedMatchId] = useState<string>(info.fightCard[0]?.id ?? "");
  const [pickCorner, setPickCorner] = useState<"red" | "blue">("red");
  const [wager, setWager] = useState<number>(150);
  const [quickKoProp, setQuickKoProp] = useState<boolean>(false);

  const [selectedTier, setSelectedTier] = useState<number>(info.nextTierIndex);
  const [selfWager, setSelfWager] = useState<number>(0);
  const [selfKoProp, setSelfKoProp] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeMatch =
    info.fightCard.find((m) => m.id === selectedMatchId) ?? info.fightCard[0];

  const baseOdds = activeMatch
    ? pickCorner === "red"
      ? activeMatch.redOdds
      : activeMatch.blueOdds
    : 1.8;
  const totalOdds = activeMatch
    ? Math.round((baseOdds + (quickKoProp ? activeMatch.koPropBonus : 0)) * 100) / 100
    : 1.8;
  const cleanWager = Math.max(0, Math.min(info.credits, Math.floor(wager)));
  const potentialPayout = Math.round(cleanWager * totalOdds);

  const selfBaseOdds = Math.round((1.45 + selectedTier * 0.28) * 100) / 100;
  const selfTotalOdds = Math.round((selfBaseOdds + (selfKoProp ? 0.9 : 0)) * 100) / 100;
  const cleanSelfWager = Math.max(0, Math.min(info.credits, Math.floor(selfWager)));
  const selfBetPayout = Math.round(cleanSelfWager * selfTotalOdds);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        data-augmented-ui="tl-clip br-clip border inlay"
        className="voss-panel-sharp relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden p-5 text-[#f2efe9]"
        style={{ "--aug-border-bg": "#f59e0b" } as React.CSSProperties}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div>
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-[#f59e0b]">
              WESTGATE UNDERGROUND · VIKTOR&apos;S BOOK
            </div>
            <h2 className="font-display text-2xl font-black uppercase tracking-wider text-[#fef3c7]">
              IRON PIT FIGHT CARD &amp; BETTING
            </h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="border border-[#22c55e]/40 bg-[#052e16]/60 px-3 py-1.5 text-right font-mono">
              <div className="text-[9px] uppercase tracking-widest text-[#86efac]">BANKROLL</div>
              <div className="text-sm font-black text-[#22c55e]">
                ${info.credits.toLocaleString()}
              </div>
            </div>
            <button
              onClick={() => game?.setFightPitBookieOpen(false)}
              className="cursor-pointer border border-white/20 bg-white/5 p-2 text-[#cbd5e1] transition hover:bg-white/15 hover:text-white"
              title="Close [Esc]"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Status Strip */}
        <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[10px] sm:grid-cols-4">
          <div className="border border-white/10 bg-black/40 px-2.5 py-1.5">
            <div className="text-[#94a3b8]">PIT RANK</div>
            <div className="font-bold text-[#fde68a]">
              TIER {Math.min(5, info.pitRank + 1)}/5 ({info.pitWins} W)
            </div>
          </div>
          <div className="border border-white/10 bg-black/40 px-2.5 py-1.5">
            <div className="text-[#94a3b8]">WIN STREAK</div>
            <div className="flex items-center gap-1 font-bold text-[#fb923c]">
              <Flame className="size-3" />
              {info.pitWinStreak} (+{info.streakBonusPct}% Purse)
            </div>
          </div>
          <div className="border border-white/10 bg-black/40 px-2.5 py-1.5">
            <div className="text-[#94a3b8]">BET RECORD</div>
            <div
              className={`font-bold ${
                info.pitBetProfit >= 0 ? "text-[#22c55e]" : "text-[#f87171]"
              }`}
            >
              {info.pitBetWins} W · {info.pitBetProfit >= 0 ? "+" : ""}$
              {info.pitBetProfit.toLocaleString()}
            </div>
          </div>
          <button
            onClick={() => {
              const res = game?.buyFightPitCutmanHeal();
              if (res && !res.ok) setErrorMsg(res.error ?? "Cannot heal");
              else setErrorMsg(null);
            }}
            disabled={health >= maxHealth || info.credits < 50}
            className="flex cursor-pointer items-center justify-between border border-[#34d399]/40 bg-[#064e3b]/40 px-2.5 py-1.5 text-left transition hover:bg-[#065f46]/60 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <div>
              <div className="text-[#6ee7b7]">CUTMAN HEAL</div>
              <div className="font-bold text-white">+100 HP · $50</div>
            </div>
            <HeartPulse className="size-4 text-[#34d399]" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => {
              setTab("card");
              setErrorMsg(null);
            }}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition ${
              tab === "card"
                ? "border-[#22c55e] bg-[#22c55e]/20 text-[#86efac]"
                : "border-white/15 bg-black/30 text-[#94a3b8] hover:text-white"
            }`}
          >
            <Coins className="size-3.5" />
            Bet On Cage Bouts
          </button>
          <button
            onClick={() => {
              setTab("fight");
              setErrorMsg(null);
            }}
            className={`flex flex-1 cursor-pointer items-center justify-center gap-2 border px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition ${
              tab === "fight"
                ? "border-[#f59e0b] bg-[#f59e0b]/20 text-[#fde68a]"
                : "border-white/15 bg-black/30 text-[#94a3b8] hover:text-white"
            }`}
          >
            <Swords className="size-3.5" />
            Fight Yourself &amp; Side-Bet
          </button>
        </div>

        {/* Content */}
        <div className="mt-3 flex-1 overflow-y-auto pr-1">
          {tab === "card" ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8]">
                  SELECT A MATCHUP &amp; PICK YOUR CORNER
                </span>
                <button
                  onClick={() => game?.refreshFightPitCard()}
                  className="flex cursor-pointer items-center gap-1.5 border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase text-[#cbd5e1] hover:bg-white/15"
                >
                  <RefreshCw className="size-3" />
                  New Card
                </button>
              </div>

              <div className="space-y-2">
                {info.fightCard.map((m) => {
                  const isSel = activeMatch?.id === m.id;
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedMatchId(m.id)}
                      className={`cursor-pointer border p-3 transition ${
                        isSel
                          ? "border-[#22c55e] bg-[#0f172a]/90"
                          : "border-white/10 bg-black/35 hover:border-white/25"
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-widest">
                        <span className="text-[#f59e0b]">{m.label}</span>
                        <span className="text-[#94a3b8]">
                          KO &lt; 25s Prop: +{m.koPropBonus.toFixed(2)}x
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMatchId(m.id);
                            setPickCorner("red");
                          }}
                          className={`cursor-pointer border p-2.5 text-left transition ${
                            isSel && pickCorner === "red"
                              ? "border-[#ef4444] bg-[#7f1d1d]/40"
                              : "border-white/10 bg-black/40 hover:border-[#ef4444]/60"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[9px] font-bold uppercase text-[#fca5a5]">
                              RED CORNER
                            </span>
                            <span className="font-mono text-sm font-black text-[#22c55e]">
                              {m.redOdds.toFixed(2)}x
                            </span>
                          </div>
                          <div className="mt-0.5 font-display text-base font-black uppercase text-white">
                            {m.red.alias}
                          </div>
                          <div className="font-mono text-[10px] text-[#cbd5e1]">
                            {m.red.style} · {m.red.record}
                          </div>
                          <div className="mt-1 font-mono text-[9px] text-[#94a3b8]">
                            PWR {m.red.power} · SPD {m.red.speed} · TGH {m.red.toughness} · HP{" "}
                            {m.red.hp}
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedMatchId(m.id);
                            setPickCorner("blue");
                          }}
                          className={`cursor-pointer border p-2.5 text-left transition ${
                            isSel && pickCorner === "blue"
                              ? "border-[#3b82f6] bg-[#1e3a8a]/40"
                              : "border-white/10 bg-black/40 hover:border-[#3b82f6]/60"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[9px] font-bold uppercase text-[#93c5fd]">
                              BLUE CORNER
                            </span>
                            <span className="font-mono text-sm font-black text-[#22c55e]">
                              {m.blueOdds.toFixed(2)}x
                            </span>
                          </div>
                          <div className="mt-0.5 font-display text-base font-black uppercase text-white">
                            {m.blue.alias}
                          </div>
                          <div className="font-mono text-[10px] text-[#cbd5e1]">
                            {m.blue.style} · {m.blue.record}
                          </div>
                          <div className="mt-1 font-mono text-[9px] text-[#94a3b8]">
                            PWR {m.blue.power} · SPD {m.blue.speed} · TGH {m.blue.toughness} · HP{" "}
                            {m.blue.hp}
                          </div>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ticket Controls */}
              {activeMatch && (
                <div className="border border-[#22c55e]/35 bg-black/55 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs">
                      <span className="text-[#94a3b8]">TICKET: </span>
                      <span className="font-bold text-white">
                        {pickCorner === "red"
                          ? activeMatch.red.alias
                          : activeMatch.blue.alias}
                      </span>
                      <span className="ml-2 text-[#22c55e]">@ {totalOdds.toFixed(2)}x</span>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 font-mono text-[11px] text-[#fde68a]">
                      <input
                        type="checkbox"
                        checked={quickKoProp}
                        onChange={(e) => setQuickKoProp(e.target.checked)}
                        className="accent-[#f59e0b]"
                      />
                      KO Finish &lt; 25s (+{activeMatch.koPropBonus.toFixed(2)}x)
                    </label>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {[50, 150, 500, 1000].map((amt) => (
                      <button
                        key={amt}
                        onClick={() => setWager(amt)}
                        className={`cursor-pointer border px-3 py-1 font-mono text-xs font-bold transition ${
                          wager === amt
                            ? "border-[#22c55e] bg-[#22c55e] text-[#052e16]"
                            : "border-white/15 bg-white/5 text-[#e2e8f0] hover:bg-white/15"
                        }`}
                      >
                        ${amt}
                      </button>
                    ))}
                    <button
                      onClick={() => setWager(info.credits)}
                      disabled={info.credits < 25}
                      className="cursor-pointer border border-[#f59e0b]/50 bg-[#f59e0b]/15 px-3 py-1 font-mono text-xs font-bold text-[#fde68a] hover:bg-[#f59e0b]/30 disabled:opacity-40"
                    >
                      ALL-IN
                    </button>
                    <div className="ml-auto font-mono text-xs text-[#cbd5e1]">
                      PAYOUT:{" "}
                      <span className="text-sm font-black text-[#22c55e]">
                        ${potentialPayout.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <button
                    disabled={cleanWager < 25 || info.credits < 25}
                    onClick={() => {
                      const res = game?.placeFightPitSpectatorBet(
                        activeMatch.id,
                        pickCorner,
                        cleanWager,
                        quickKoProp,
                      );
                      if (res && !res.ok) setErrorMsg(res.error ?? "Bet failed");
                    }}
                    className="mt-3 w-full cursor-pointer bg-[#22c55e] py-2.5 font-mono text-xs font-black uppercase tracking-[0.2em] text-[#052e16] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    LOCK ${cleanWager.toLocaleString()} BET &amp; START CAGE BOUT
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="font-mono text-[10px] uppercase tracking-widest text-[#94a3b8]">
                CHALLENGE ANY UNLOCKED TIER · OPTIONAL SELF-BET
              </div>
              {info.tiers.map((t, idx) => {
                const unlocked = idx <= info.pitRank;
                const isSel = selectedTier === idx;
                const effectivePurse = Math.round(
                  t.purse * (1 + info.streakBonusPct / 100),
                );
                return (
                  <button
                    key={t.id}
                    disabled={!unlocked}
                    onClick={() => setSelectedTier(idx)}
                    className={`flex w-full cursor-pointer items-center justify-between border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      isSel
                        ? "border-[#f59e0b] bg-[#78350f]/35"
                        : "border-white/10 bg-black/35 hover:border-white/25"
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2 font-mono text-[10px] uppercase">
                        <span className="font-bold text-[#f59e0b]">
                          TIER {t.tier}
                        </span>
                        <span className="text-[#94a3b8]">
                          {t.style} · {t.record}
                        </span>
                        {!unlocked && (
                          <span className="bg-white/10 px-1.5 py-0.5 text-[9px] text-[#94a3b8]">
                            LOCKED
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 font-display text-base font-black uppercase text-white">
                        {t.alias}
                      </div>
                      <div className="font-mono text-[10px] text-[#cbd5e1]">
                        HP {t.hp} · Power {Math.round(t.damageScale * 100)}%
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="flex items-center justify-end gap-1 text-sm font-black text-[#22c55e]">
                        <Trophy className="size-3.5" />$
                        {effectivePurse.toLocaleString()}
                      </div>
                      <div className="text-[10px] text-[#fde68a]">
                        Self-Odds {(1.45 + idx * 0.28).toFixed(2)}x
                      </div>
                    </div>
                  </button>
                );
              })}

              <div className="border border-[#f59e0b]/40 bg-black/55 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs">
                  <span className="text-[#fde68a]">
                    SELF SIDE-BET:{" "}
                    <strong>
                      {cleanSelfWager > 0
                        ? `$${cleanSelfWager.toLocaleString()} @ ${selfTotalOdds.toFixed(2)}x -> $${selfBetPayout.toLocaleString()}`
                        : "NONE"}
                    </strong>
                  </span>
                  <label className="flex cursor-pointer items-center gap-2 text-[11px] text-[#fde68a]">
                    <input
                      type="checkbox"
                      checked={selfKoProp}
                      onChange={(e) => setSelfKoProp(e.target.checked)}
                      className="accent-[#f59e0b]"
                    />
                    Quick KO &lt; 35s (+0.90x)
                  </label>
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  {[0, 100, 250, 500, 1000].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => setSelfWager(amt)}
                      disabled={amt > info.credits}
                      className={`cursor-pointer border px-3 py-1 font-mono text-xs font-bold transition disabled:opacity-35 ${
                        selfWager === amt
                          ? "border-[#f59e0b] bg-[#f59e0b] text-[#07080b]"
                          : "border-white/15 bg-white/5 text-[#e2e8f0] hover:bg-white/15"
                      }`}
                    >
                      {amt === 0 ? "NO BET" : `$${amt}`}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => {
                    const res = game?.startFightPitPlayerBout(
                      selectedTier,
                      cleanSelfWager,
                      selfKoProp,
                    );
                    if (res && !res.ok) setErrorMsg(res.error ?? "Failed to start");
                  }}
                  className="mt-3 w-full cursor-pointer bg-[#f59e0b] py-2.5 font-mono text-xs font-black uppercase tracking-[0.2em] text-[#07080b] transition hover:brightness-110"
                >
                  STEP INTO THE IRON PIT (TIER {selectedTier + 1})
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mt-2 border border-[#ef4444]/50 bg-[#7f1d1d]/40 px-3 py-2 font-mono text-xs text-[#fca5a5]">
              {errorMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
