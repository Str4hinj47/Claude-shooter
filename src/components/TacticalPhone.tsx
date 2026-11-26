import { useEffect, useState } from "react";
import {
  BatteryCharging,
  Briefcase,
  Building2,
  Camera,
  Car,
  ChevronLeft,
  CloudRain,
  CloudSnow,
  Compass,
  Crosshair,
  Home,
  Map as MapIcon,
  MessageSquare,
  Moon,
  Navigation,
  Phone,
  PhoneCall,
  Radio,
  Shield,
  Signal,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Trash2,
  UserCheck,
  Wifi,
  X,
} from "lucide-react";
import type { Game, HudState } from "../game/Game";
import {
  getStoryChapterForSurveillance,
  isStoryChapterCompleted,
  isStoryChapterUnlocked,
  MISSIONS,
  STORYLINE_CHAPTERS,
  type MissionDef,
  type StoryChapterDef,
} from "../game/story";
import { CARS, type CarId } from "../game/vehicles/catalog";
import { WESTGATE_CONTRACT_SPOTS } from "../game/city/WestgateActivities";
import { SAFEHOUSE_SPAWN } from "../game/city/SafehouseResidence";
import { SURVEILLANCE_CONTRACTS } from "../game/city/ContractSurveillance";
import { STARTER_BOAT_DOCK } from "../game/vehicles/water/BoatSystem";
import { TIME_OF_DAY_LABELS, TIME_OF_DAY_MODES, WESTGATE_TELEPORTS, type TimeOfDayMode } from "../game/city/WestgateMeta";
import { WEATHER_MODES, type WeatherMode } from "../game/vehicles/weather";
import { APARTMENTS, type ApartmentId, type SaveData } from "../game/progression";
import { getStorySmsFeed } from "../game/missionCalls";
import type { GpsWaypoint } from "../game/city/GpsWaypoint";

type PhoneApp = "home" | "contacts" | "messages" | "contracts" | "motors" | "realty" | "gps" | "skyos" | "snapmatic" | "vitals";

interface SnapPhoto {
  id: string;
  dataUrl: string;
  district: string;
  timeLabel: string;
}

const SNAP_STORAGE_KEY = "westgate-snapmatic-v1";

function loadSnaps(): SnapPhoto[] {
  try {
    const raw = localStorage.getItem(SNAP_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveSnaps(list: SnapPhoto[]) {
  try {
    localStorage.setItem(SNAP_STORAGE_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {}
}

interface TacticalPhoneProps {
  open: boolean;
  hud: HudState;
  save: SaveData;
  gameRef: React.MutableRefObject<Game | null>;
  gpsTargetId: string | null;
  onSetGpsTarget: (id: string | null, custom?: GpsWaypoint | null) => void;
  onStartMission: (m: MissionDef) => void;
  onStartStoryChapter?: (ch: StoryChapterDef) => void;
  onBuyCar: (carId: CarId) => void;
  onSelectCar: (carId: CarId, paintHex?: string | null) => void;
  onBuyApartment?: (id: ApartmentId) => void;
  onClose: () => void;
}

const PAINT_SWATCHES = ["#0f172a", "#dc2626", "#2563eb", "#0d3b2e", "#f59e0b", "#f8fafc", "#475569"];

export function TacticalPhone({
  open,
  hud,
  save,
  gameRef,
  gpsTargetId,
  onSetGpsTarget,
  onStartMission,
  onStartStoryChapter,
  onBuyCar,
  onSelectCar,
  onBuyApartment,
  onClose,
}: TacticalPhoneProps) {
  const [app, setApp] = useState<PhoneApp>("home");
  const [callBanner, setCallBanner] = useState<{ who: string; line: string } | null>(null);
  const [snaps, setSnaps] = useState<SnapPhoto[]>(() => loadSnaps());
  const [flashPhoto, setFlashPhoto] = useState(false);
  const [selectedMotor, setSelectedMotor] = useState<CarId>(save.selectedCar ?? "golf");
  const [contractTab, setContractTab] = useState<"hits" | "story">("hits");

  useEffect(() => {
    if (open && hud.phoneInitialTab === "contracts") {
      setApp("contracts");
    }
  }, [open, hud.phoneInitialTab]);

  useEffect(() => {
    if (!callBanner) return;
    const t = setTimeout(() => setCallBanner(null), 3400);
    return () => clearTimeout(t);
  }, [callBanner]);

  if (!open) return null;

  const smsFeed = getStorySmsFeed(save);
  const timeClock =
    hud.timeOfDay === "dawn"
      ? "06:15"
      : hud.timeOfDay === "sunset"
        ? "18:42"
        : hud.timeOfDay === "night"
          ? "22:30"
          : "15:20";

  const triggerCall = (who: string, line: string, action?: () => void) => {
    setCallBanner({ who, line });
    action?.();
  };

  const handleSnapmatic = () => {
    setFlashPhoto(true);
    setTimeout(() => setFlashPhoto(false), 180);
    const dataUrl = gameRef.current?.captureSnapmaticPhoto();
    if (!dataUrl) return;
    const next: SnapPhoto = {
      id: `${Date.now()}`,
      dataUrl,
      district: hud.district?.name ?? hud.mission?.location ?? "Westgate Bay",
      timeLabel: hud.timeOfDayLabel,
    };
    const updated = [next, ...snaps].slice(0, 8);
    setSnaps(updated);
    saveSnaps(updated);
  };

  const handleDeleteSnap = (id: string) => {
    const updated = snaps.filter((s) => s.id !== id);
    setSnaps(updated);
    saveSnaps(updated);
  };

  const summonPersonalCar = () => {
    const carId = save.selectedCar ?? "golf";
    const paint = save.carPaints[carId];
    gameRef.current?.summonSelectedCar(carId, paint);
    const carName = CARS.find((c) => c.id === carId)?.name ?? "Personal Vehicle";
    triggerCall("Johnny · Westgate Mechanic", `${carName} delivered right beside your location.`);
  };

  const goHomeSafehouse = () => {
    if (!hud.isOpenWorld) {
      triggerCall("Concierge", "Safehouse fast-travel is only available in Westgate Bay.");
      return;
    }
    gameRef.current?.teleportTo(SAFEHOUSE_SPAWN[0], SAFEHOUSE_SPAWN[1], SAFEHOUSE_SPAWN[2]);
    onClose();
  };

  const appMeta: Record<PhoneApp, { title: string; accent: string }> = {
    home: { title: "SkyOS 19", accent: "#38bdf8" },
    contacts: { title: "Contacts", accent: "#34d399" },
    messages: { title: "Encrypted Comms", accent: "#38bdf8" },
    contracts: { title: "Broker Jobs", accent: "#f59e0b" },
    motors: { title: "Westgate Motors", accent: "#ef4444" },
    realty: { title: "Dynasty 8 Realty", accent: "#fbbf24" },
    gps: { title: "Westgate GPS", accent: "#38bdf8" },
    skyos: { title: "Atmosphere", accent: "#a78bfa" },
    snapmatic: { title: "Snapmatic Pro", accent: "#f472b6" },
    vitals: { title: "Operative ID", accent: "#2dd4bf" },
  };

  return (
    <div
      className="pointer-events-auto fixed bottom-5 right-5 z-30 flex flex-col items-end animate-[fadeIn_0.16s_ease-out]"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Sleek Titanium Edge Flagship Frame (iFruit / SkyPhone X19 Pro) */}
      <div className="relative flex h-[540px] w-[284px] flex-col overflow-hidden rounded-[34px] border-[2px] border-white/25 bg-[#060911] p-2.5 shadow-[0_24px_70px_rgba(0,0,0,0.85),0_0_0_1px_rgba(56,189,248,0.18)]">
        {/* Inner OLED Display */}
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[26px] bg-gradient-to-b from-[#0b1324] via-[#090d18] to-[#05070d]">
          {/* Subtle animated wallpaper aurora */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(56,189,248,0.22),transparent_48%),radial-gradient(circle_at_85%_75%,rgba(245,158,11,0.16),transparent_52%)]" />

          {/* Camera shutter flash */}
          {flashPhoto && <div className="pointer-events-none absolute inset-0 z-50 bg-white/85" />}

          {/* Dynamic Island + Status Bar */}
          <div className="relative z-10 flex items-center justify-between px-4 pb-1.5 pt-2.5 text-[10px] font-semibold text-white/90">
            <span className="font-mono tracking-tight">{timeClock}</span>
            <div className="flex h-4 w-20 items-center justify-between rounded-full bg-black px-2 shadow-inner ring-1 ring-white/10">
              <span className="size-1.5 rounded-full bg-[#38bdf8]" />
              <span className="size-1.5 rounded-full bg-[#1e293b]" />
            </div>
            <div className="flex items-center gap-1 text-white/85">
              <Signal className="size-2.5 text-[#38bdf8]" />
              <Wifi className="size-2.5" />
              <BatteryCharging className="size-3 text-[#34d399]" />
            </div>
          </div>

          {/* Sub-app Header */}
          {app !== "home" && (
            <div className="relative z-10 flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-2 backdrop-blur">
              <button
                onClick={() => setApp("home")}
                className="flex cursor-pointer items-center gap-0.5 text-[11px] font-semibold text-[#38bdf8] hover:text-white"
              >
                <ChevronLeft className="size-3.5" />
                Back
              </button>
              <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-white">
                {appMeta[app].title}
              </span>
              <button
                onClick={onClose}
                className="cursor-pointer rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"
                title="Put away phone [P / ↑]"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}

          {/* Live Incoming / Active Voice Briefing Call inside SkyPhone */}
          {hud.incomingCall && (
            <div
              className="relative z-20 mx-2.5 mt-2 rounded-2xl border bg-[#071522]/95 p-2.5 shadow-lg backdrop-blur"
              style={{ borderColor: `${hud.incomingCall.accent}77` }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: hud.incomingCall.accent }}>
                  <PhoneCall className="size-3 animate-pulse" />
                  <span>{hud.incomingCall.callerName} · {hud.incomingCall.codename}</span>
                </div>
                <button
                  onClick={() => gameRef.current?.hangUpCall()}
                  className="cursor-pointer rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase text-rose-300 hover:bg-rose-500/35"
                >
                  End
                </button>
              </div>
              {hud.incomingCall.status === "ringing" ? (
                <button
                  onClick={() => gameRef.current?.answerCall(false)}
                  className="mt-1.5 w-full cursor-pointer rounded-xl bg-emerald-500 py-1 font-mono text-[10px] font-bold uppercase text-black hover:bg-emerald-400"
                >
                  Answer Call
                </button>
              ) : (
                <p className="mt-1 max-h-20 overflow-y-auto text-[10px] leading-snug text-white/90">
                  “{hud.incomingCall.transcript}”
                </p>
              )}
            </div>
          )}

          {/* Active Call Notification Pill */}
          {callBanner && !hud.incomingCall && (
            <div className="relative z-20 mx-2.5 mt-2 rounded-2xl border border-[#34d399]/40 bg-[#071e17]/95 p-2.5 shadow-lg backdrop-blur">
              <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-[#34d399]">
                <PhoneCall className="size-3 animate-pulse" />
                <span>{callBanner.who}</span>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-white/90">{callBanner.line}</p>
            </div>
          )}

          {/* ================= APP BODY ================= */}
          <div className="relative z-10 flex-1 overflow-y-auto px-3 py-2.5 scrollbar-thin">
            {app === "home" && (
              <div className="flex h-full flex-col justify-between">
                {/* Top Hero Lock/Home Widget */}
                <div>
                  <div className="flex items-start justify-between px-1">
                    <div>
                      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-[#38bdf8]">
                        {hud.isOpenWorld ? hud.district?.name ?? "Westgate Bay" : hud.mission?.codename}
                      </div>
                      <div className="font-display text-3xl font-extrabold leading-none tracking-tight text-white">
                        {timeClock}
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/60">
                        {hud.timeOfDayLabel} · {hud.weatherLabel} · ${hud.credits.toLocaleString()} Cr
                      </div>
                    </div>
                    <button
                      onClick={onClose}
                      className="cursor-pointer rounded-full border border-white/15 bg-white/5 p-1.5 text-white/60 hover:bg-white/15 hover:text-white"
                      title="Close [P / ↑]"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>

                  {/* Quick Delivery Banner */}
                  <button
                    onClick={summonPersonalCar}
                    className="mt-3 flex w-full cursor-pointer items-center justify-between rounded-2xl border border-[#38bdf8]/30 bg-gradient-to-r from-[#0f2942]/80 to-[#0d1c30]/80 px-3 py-2 text-left transition hover:border-[#38bdf8]/70"
                  >
                    <div>
                      <div className="font-mono text-[9px] font-bold uppercase tracking-wider text-[#38bdf8]">
                        Quick Summon
                      </div>
                      <div className="text-xs font-semibold text-white">
                        Deliver {CARS.find((c) => c.id === (save.selectedCar ?? "golf"))?.name ?? "Car"}
                      </div>
                    </div>
                    <Car className="size-4 text-[#38bdf8]" />
                  </button>
                </div>

                {/* 3x3 Modern App Grid */}
                <div className="grid grid-cols-3 gap-2.5 px-0.5 py-2">
                  <AppTile
                    icon={<Phone className="size-5 text-white" />}
                    label="Contacts"
                    bg="from-emerald-500 to-teal-600"
                    onClick={() => setApp("contacts")}
                  />
                  <AppTile
                    icon={<MessageSquare className="size-5 text-white" />}
                    label={`Comms (${smsFeed.length})`}
                    bg="from-sky-500 to-indigo-600"
                    onClick={() => setApp("messages")}
                  />
                  <AppTile
                    icon={<Briefcase className="size-5 text-white" />}
                    label="Contracts"
                    bg="from-amber-500 to-orange-600"
                    onClick={() => setApp("contracts")}
                  />
                  <AppTile
                    icon={<Car className="size-5 text-white" />}
                    label="Motors"
                    bg="from-rose-500 to-red-600"
                    onClick={() => setApp("motors")}
                  />
                  <AppTile
                    icon={<Navigation className="size-5 text-white" />}
                    label="GPS"
                    bg="from-sky-400 to-blue-600"
                    onClick={() => setApp("gps")}
                  />
                  <AppTile
                    icon={<Camera className="size-5 text-white" />}
                    label="Snapmatic"
                    bg="from-fuchsia-500 to-pink-600"
                    onClick={() => setApp("snapmatic")}
                  />
                  <AppTile
                    icon={<Sparkles className="size-5 text-white" />}
                    label="SkyOS"
                    bg="from-violet-500 to-indigo-600"
                    onClick={() => setApp("skyos")}
                  />
                  <AppTile
                    icon={<Shield className="size-5 text-white" />}
                    label="Vitals"
                    bg="from-cyan-500 to-teal-700"
                    onClick={() => setApp("vitals")}
                  />
                  <AppTile
                    icon={<Home className="size-5 text-white" />}
                    label="Safehouse"
                    bg="from-amber-400 to-yellow-600"
                    onClick={goHomeSafehouse}
                  />
                  <AppTile
                    icon={<Building2 className="size-5 text-white" />}
                    label="Realty"
                    bg="from-yellow-500 to-amber-700"
                    onClick={() => setApp("realty")}
                  />
                  <AppTile
                    icon={<MapIcon className="size-5 text-white" />}
                    label="Full Map"
                    bg="from-slate-600 to-slate-800"
                    onClick={() => {
                      onClose();
                      gameRef.current?.setMapOpen(true);
                    }}
                  />
                </div>

                {/* Translucent Bottom Dock */}
                <div className="flex items-center justify-around rounded-2xl border border-white/10 bg-white/[0.06] px-2 py-2 backdrop-blur-md">
                  <button
                    onClick={() => setApp("contacts")}
                    className="cursor-pointer rounded-xl bg-emerald-500/20 p-2 text-emerald-400 hover:bg-emerald-500/35"
                    title="Contacts"
                  >
                    <Phone className="size-4" />
                  </button>
                  <button
                    onClick={() => setApp("messages")}
                    className="cursor-pointer rounded-xl bg-sky-500/20 p-2 text-sky-400 hover:bg-sky-500/35"
                    title="Encrypted Comms"
                  >
                    <MessageSquare className="size-4" />
                  </button>
                  <button
                    onClick={() => setApp("contracts")}
                    className="cursor-pointer rounded-xl bg-amber-500/20 p-2 text-amber-400 hover:bg-amber-500/35"
                    title="Broker Contracts"
                  >
                    <Briefcase className="size-4" />
                  </button>
                  <button
                    onClick={handleSnapmatic}
                    className="cursor-pointer rounded-xl bg-pink-500/20 p-2 text-pink-400 hover:bg-pink-500/35"
                    title="Instant Snapmatic"
                  >
                    <Camera className="size-4" />
                  </button>
                </div>
              </div>
            )}

            {/* ---------------- ENCRYPTED COMMS / STORY SMS APP ---------------- */}
            {app === "messages" && (
              <div className="space-y-2.5">
                <div className="px-1 font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300">
                  Encrypted Thread · Ghost vs Loud Intel
                </div>
                {smsFeed.map((msg) => (
                  <div
                    key={msg.id}
                    className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5"
                    style={{ borderColor: `${msg.accent}33` }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: msg.accent }}>
                        {msg.sender}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {msg.tag && (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase ${
                              msg.tag === "GHOST"
                                ? "bg-emerald-500/20 text-emerald-300"
                                : msg.tag === "LOUD"
                                  ? "bg-rose-500/20 text-rose-300"
                                  : msg.tag === "CLOSED"
                                    ? "bg-purple-500/20 text-purple-300"
                                    : "bg-sky-500/20 text-sky-300"
                            }`}
                          >
                            {msg.tag}
                          </span>
                        )}
                        <span className="font-mono text-[8px] text-white/40">{msg.role}</span>
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-white/90">{msg.text}</p>
                    {msg.reply && (
                      <div className="mt-1.5 ml-6 rounded-xl bg-sky-500/18 px-2.5 py-1 text-right text-[10px] font-medium text-sky-100">
                        <span className="mr-1 font-mono text-[8px] uppercase text-sky-300/80">Voss:</span>
                        “{msg.reply}”
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ---------------- CONTACTS APP ---------------- */}
            {app === "contacts" && (
              <div className="space-y-2">
                <ContactCard
                  name="The Broker · Briefing"
                  role="Replay Current Mission Call"
                  color="bg-amber-500"
                  actionLabel="Call"
                  onAction={() => {
                    gameRef.current?.replayMissionCall();
                    triggerCall(
                      "Mara Vance · Broker",
                      `Replaying encrypted mission voice briefing on your speakerphone.`,
                    );
                  }}
                />
                <ContactCard
                  name="Johnny · Mechanic"
                  role="Garage & Delivery"
                  color="bg-sky-500"
                  actionLabel="Deliver Car"
                  onAction={summonPersonalCar}
                />
                <ContactCard
                  name="Harbor Master · Dock 1"
                  role="Bayliner Starter Skiff"
                  color="bg-cyan-500"
                  actionLabel="Bring Boat"
                  onAction={() => {
                    if (!hud.isOpenWorld) {
                      triggerCall("Harbor Master", "Boat delivery is available in Westgate Bay Open World.");
                      return;
                    }
                    const b = gameRef.current?.summonStarterBoat();
                    if (b) {
                      triggerCall(
                        "Harbor Master",
                        `Your ${b.name} is moored off the nearest shoreline at (${Math.round(b.pos.x)}, ${Math.round(b.pos.z)}).`,
                      );
                    }
                  }}
                />
                <ContactCard
                  name="420 Crescent Concierge"
                  role="Old Quarter Safehouse"
                  color="bg-emerald-500"
                  actionLabel="Go Home"
                  onAction={goHomeSafehouse}
                />
                <ContactCard
                  name="Voss Tactical AI"
                  role="Field Ops Overwatch"
                  color="bg-violet-500"
                  actionLabel="Status"
                  onAction={() =>
                    triggerCall(
                      "Voss Overwatch",
                      `Vitals ${Math.round(hud.health)}/${hud.maxHealth} · Stealth ${hud.stealthState.toUpperCase()} · ${hud.stealthKills} silent takedowns.`,
                    )
                  }
                />
              </div>
            )}

            {/* ---------------- CONTRACTS APP ---------------- */}
            {app === "contracts" && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-black/40 p-1">
                  <button
                    onClick={() => setContractTab("hits")}
                    className={`cursor-pointer rounded-lg py-1 font-mono text-[9px] font-bold uppercase ${
                      contractTab === "hits"
                        ? "bg-amber-500 text-black"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    Live Hits (Open)
                  </button>
                  <button
                    onClick={() => setContractTab("story")}
                    className={`cursor-pointer rounded-lg py-1 font-mono text-[9px] font-bold uppercase ${
                      contractTab === "story"
                        ? "bg-amber-500 text-black"
                        : "text-white/60 hover:text-white"
                    }`}
                  >
                    Storyline (00–09)
                  </button>
                </div>

                {contractTab === "hits" ? (
                  <div className="space-y-2">
                    {!hud.isOpenWorld && (
                      <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2 text-[10px] text-amber-200">
                        Deploy into Westgate Bay Open World or launch a hit directly into the story sequence.
                      </div>
                    )}
                    {hud.surveillance && (
                      <div className="rounded-2xl border border-amber-400/50 bg-amber-500/10 p-2.5">
                        <div className="flex items-center justify-between font-mono text-[9px] font-bold uppercase text-amber-300">
                          <span>Active · {hud.surveillance.dayClock}</span>
                          <span>{hud.surveillance.strikeStatus}</span>
                        </div>
                        <div className="mt-0.5 text-xs font-bold text-white">{hud.surveillance.targetName}</div>
                        <div className="text-[10px] text-white/70">{hud.surveillance.phaseLabel}</div>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            onClick={() => gameRef.current?.advanceSurveillanceClock(1.0)}
                            className="flex-1 cursor-pointer rounded-xl border border-sky-400/40 bg-sky-500/20 py-1 text-[10px] font-bold text-sky-200 hover:bg-sky-500/30"
                          >
                            +1h Stakeout
                          </button>
                          <button
                            onClick={() => gameRef.current?.abortSurveillanceContract()}
                            className="cursor-pointer rounded-xl border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-[10px] font-bold text-rose-200 hover:bg-rose-500/30"
                          >
                            Abort
                          </button>
                        </div>
                      </div>
                    )}
                    {SURVEILLANCE_CONTRACTS.map((c) => {
                      const rec = save.surveillanceRecords?.[c.id];
                      const activeThis = hud.surveillance?.contractId === c.id;
                      const storyCh = getStoryChapterForSurveillance(c.id);
                      const unlocked = storyCh ? isStoryChapterUnlocked(storyCh, save) : true;
                      return (
                        <div
                          key={c.id}
                          className={`rounded-2xl border p-2.5 ${
                            activeThis
                              ? "border-amber-400/70 bg-amber-500/10"
                              : "border-white/10 bg-white/[0.04]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-amber-400">
                              {storyCh ? `CH ${storyCh.code} · ` : ""}{c.code} · {c.title}
                            </span>
                            {rec?.completed && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[8px] font-bold text-emerald-300">
                                {rec.unseen ? "GHOST" : "CLEARED"}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs font-bold text-white">{c.targetName}</div>
                          <div className="text-[10px] text-white/60">
                            {c.targetRoleTitle} · {c.vehicle.label}
                          </div>
                          <div className="mt-1 text-[10px] leading-snug text-white/55">
                            Home: {c.residence.address} · Ocean Disposal Required
                          </div>
                          <div className="mt-1 font-mono text-[9px] text-emerald-300">
                            ${c.rewardBase} + ${c.unseenBonus} Unseen + ${c.deepSeaBonus} Deep Sea
                          </div>
                          <div className="mt-2 flex gap-1.5">
                            <button
                              disabled={!hud.isOpenWorld}
                              onClick={() => {
                                onSetGpsTarget(`surv_home_${c.id}`, {
                                  id: `surv_home_${c.id}`,
                                  x: c.residence.x,
                                  z: c.residence.z,
                                  label: `${c.targetName} Residence`,
                                });
                                onClose();
                              }}
                              className="flex-1 cursor-pointer rounded-xl border border-sky-400/35 bg-sky-500/15 py-1 text-[10px] font-semibold text-sky-300 hover:bg-sky-500/30 disabled:opacity-40"
                            >
                              GPS Home
                            </button>
                            <button
                              disabled={!unlocked && !hud.isOpenWorld}
                              onClick={() => {
                                if (hud.isOpenWorld) {
                                  gameRef.current?.startSurveillanceContract(c.id, 7.1);
                                  onSetGpsTarget(`surv_home_${c.id}`, {
                                    id: `surv_home_${c.id}`,
                                    x: c.residence.x,
                                    z: c.residence.z,
                                    label: `Target: ${c.targetName}`,
                                  });
                                  onClose();
                                } else if (storyCh && onStartStoryChapter) {
                                  onClose();
                                  onStartStoryChapter(storyCh);
                                }
                              }}
                              className="flex-1 cursor-pointer rounded-xl bg-amber-500 py-1 text-[10px] font-bold text-black hover:bg-amber-400 disabled:opacity-40"
                            >
                              {activeThis ? "Restart" : unlocked ? "Accept Hit" : "Locked"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  STORYLINE_CHAPTERS.map((ch) => {
                    const unlocked = isStoryChapterUnlocked(ch, save);
                    const completed = isStoryChapterCompleted(ch, save);
                    const isSurv = ch.kind === "surveillance" && ch.surveillanceId;
                    const survDef = isSurv ? SURVEILLANCE_CONTRACTS.find((c) => c.id === ch.surveillanceId) : undefined;
                    const spot = ch.missionId !== undefined ? WESTGATE_CONTRACT_SPOTS.find((s) => s.missionId === ch.missionId) : undefined;
                    return (
                      <div
                        key={ch.chapter}
                        className="rounded-2xl border border-white/10 bg-white/[0.04] p-2.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[9px] font-bold uppercase tracking-wider" style={{ color: ch.accent }}>
                            CH {ch.code} · {ch.codename}
                          </span>
                          <div className="flex items-center gap-1">
                            {isSurv && (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[8px] font-bold text-amber-300">
                                SURV / TAKEDOWN
                              </span>
                            )}
                            {completed && (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[8px] font-bold text-emerald-300">
                                CLEARED
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-0.5 text-xs font-bold text-white">{ch.title}</div>
                        <div className="text-[10px] text-white/55">{ch.location}</div>
                        <div className="mt-2 flex gap-1.5">
                          {hud.isOpenWorld && (spot || survDef) && (
                            <button
                              onClick={() => {
                                if (survDef) {
                                  onSetGpsTarget(`surv_home_${survDef.id}`, {
                                    id: `surv_home_${survDef.id}`,
                                    x: survDef.residence.x,
                                    z: survDef.residence.z,
                                    label: `Ch ${ch.code}: ${survDef.targetName}`,
                                  });
                                } else if (spot) {
                                  onSetGpsTarget(`contract_${ch.missionId}`, {
                                    id: `contract_${ch.missionId}`,
                                    x: spot.x,
                                    z: spot.z,
                                    label: `Ch ${ch.code}: ${ch.codename}`,
                                  });
                                }
                                onClose();
                              }}
                              className="flex-1 cursor-pointer rounded-xl border border-sky-400/35 bg-sky-500/15 py-1 text-[10px] font-semibold text-sky-300 hover:bg-sky-500/30"
                            >
                              GPS Pin
                            </button>
                          )}
                          <button
                            disabled={!unlocked}
                            onClick={() => {
                              onClose();
                              if (onStartStoryChapter) {
                                onStartStoryChapter(ch);
                              } else if (ch.missionId !== undefined) {
                                const m = MISSIONS.find((mi) => mi.id === ch.missionId);
                                if (m) onStartMission(m);
                              }
                            }}
                            className={`flex-1 cursor-pointer rounded-xl py-1 text-[10px] font-bold transition ${
                              unlocked
                                ? "bg-amber-500 text-black hover:bg-amber-400"
                                : "cursor-not-allowed bg-white/10 text-white/35"
                            }`}
                          >
                            {unlocked ? "Launch" : "Locked"}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ---------------- WESTGATE MOTORS APP ---------------- */}
            {app === "motors" && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1.5">
                  <span className="font-mono text-[9px] uppercase text-white/60">Balance</span>
                  <span className="font-mono text-xs font-bold text-amber-400">{save.currencies.credits} CR</span>
                </div>
                {CARS.map((car) => {
                  const owned = save.ownedCars.includes(car.id);
                  const active = save.selectedCar === car.id;
                  const expanded = selectedMotor === car.id;
                  const canBuy = save.currencies.credits >= car.price;
                  return (
                    <div
                      key={car.id}
                      onClick={() => setSelectedMotor(car.id)}
                      className={`cursor-pointer rounded-2xl border p-2.5 transition ${
                        active
                          ? "border-[#38bdf8]/60 bg-[#38bdf8]/10"
                          : "border-white/10 bg-white/[0.04] hover:border-white/25"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold text-white">{car.name}</div>
                          <div className="text-[10px] text-white/55">
                            {car.maker} · {car.klass}
                          </div>
                        </div>
                        {owned ? (
                          <span className="rounded-lg bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300">
                            {active ? "ACTIVE" : "OWNED"}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] font-bold text-amber-400">{car.price} CR</span>
                        )}
                      </div>

                      {expanded && (
                        <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
                          <div className="grid grid-cols-3 gap-1.5 text-[9px] text-white/70">
                            <div>SPD {car.stats.speed}/5</div>
                            <div>HND {car.stats.handling}/5</div>
                            <div>GRP {car.stats.grip}/5</div>
                          </div>
                          {owned && (
                            <div className="flex items-center gap-1.5">
                              {PAINT_SWATCHES.map((hex) => (
                                <button
                                  key={hex}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectCar(car.id, hex);
                                  }}
                                  className="size-4 cursor-pointer rounded-full border border-white/30"
                                  style={{ background: hex }}
                                  title="Apply paint & summon"
                                />
                              ))}
                            </div>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (owned) onSelectCar(car.id, save.carPaints[car.id]);
                              else if (canBuy) onBuyCar(car.id);
                            }}
                            disabled={!owned && !canBuy}
                            className={`w-full cursor-pointer rounded-xl py-1.5 text-[10px] font-bold uppercase tracking-wider ${
                              owned
                                ? "bg-[#38bdf8] text-black hover:bg-sky-300"
                                : canBuy
                                  ? "bg-amber-500 text-black hover:bg-amber-400"
                                  : "cursor-not-allowed bg-white/10 text-white/35"
                            }`}
                          >
                            {owned ? "Deliver Now" : canBuy ? `Buy · ${car.price} CR` : "Insufficient Credits"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---------------- GPS NAVIGATION APP ---------------- */}
            {app === "gps" && (
              <div className="space-y-1.5">
                {!hud.isOpenWorld && (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-2 text-[10px] text-amber-200">
                    GPS fast-travel & route markers activate in Westgate Bay Open World.
                  </div>
                )}
                {hud.isOpenWorld && (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/10 p-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-cyan-200">
                        Bayliner Starter Skiff (Marina)
                      </div>
                      <div className="font-mono text-[9px] text-cyan-200/60">
                        ({STARTER_BOAT_DOCK.x}, {STARTER_BOAT_DOCK.z})
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        onSetGpsTarget("starter_boat", {
                          id: "starter_boat",
                          x: STARTER_BOAT_DOCK.x,
                          z: STARTER_BOAT_DOCK.z,
                          label: "Starter Boat · Pacific Marina",
                          color: "#22d3ee",
                        });
                        onClose();
                      }}
                      className="cursor-pointer rounded-lg bg-cyan-500/25 px-2 py-1 text-[9px] font-bold text-cyan-200 hover:bg-cyan-500/40"
                    >
                      Route
                    </button>
                  </div>
                )}
                {WESTGATE_TELEPORTS.map((tp) => {
                  const selected = gpsTargetId === tp.id;
                  return (
                    <div
                      key={tp.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border p-2 ${
                        selected ? "border-sky-400 bg-sky-500/15" : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-semibold text-white">{tp.label}</div>
                        <div className="font-mono text-[9px] text-white/45">
                          ({Math.round(tp.x)}, {Math.round(tp.z)})
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          onClick={() => {
                            onSetGpsTarget(tp.id, null);
                            onClose();
                          }}
                          className="cursor-pointer rounded-lg bg-sky-500/20 px-2 py-1 text-[9px] font-bold text-sky-300 hover:bg-sky-500/35"
                        >
                          Route
                        </button>
                        {hud.isOpenWorld && (
                          <button
                            onClick={() => {
                              gameRef.current?.teleportTo(tp.x, tp.z, tp.yawDeg);
                              onClose();
                            }}
                            className="cursor-pointer rounded-lg bg-white/10 px-2 py-1 text-[9px] font-bold text-white hover:bg-white/25"
                          >
                            Go
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---------------- DYNASTY 8 REALTY APP ---------------- */}
            {app === "realty" && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between px-1 font-mono text-[10px] text-amber-300">
                  <span>WESTGATE RESIDENCES</span>
                  <span>{save.currencies.credits} CR</span>
                </div>
                {APARTMENTS.map((apt) => {
                  const owned = (save.ownedApartments ?? []).includes(apt.id);
                  const canBuy = save.currencies.credits >= apt.price;
                  return (
                    <div
                      key={apt.id}
                      className={`rounded-2xl border p-2.5 ${
                        owned ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-bold text-white">{apt.name}</span>
                        <span className={`font-mono text-[10px] font-bold ${owned ? "text-emerald-300" : "text-amber-300"}`}>
                          {owned ? "OWNED" : `${apt.price} CR`}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-white/60">
                        {apt.address} · {apt.sqft.toLocaleString()} sqft
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        <button
                          onClick={() => {
                            onSetGpsTarget(apt.id, {
                              id: apt.id,
                              label: apt.name,
                              x: apt.exitStreetPos.x,
                              z: apt.exitStreetPos.z,
                              color: apt.accentHex,
                            });
                            triggerCall("Dynasty 8 GPS", `Route set to ${apt.name} entrance.`);
                          }}
                          className="flex-1 cursor-pointer rounded-xl border border-sky-400/35 bg-sky-500/15 py-1.5 font-mono text-[10px] font-bold text-sky-200 hover:bg-sky-500/25"
                        >
                          GPS to Door
                        </button>
                        {owned ? (
                          <button
                            onClick={() => {
                              gameRef.current?.enterApartment(apt.id);
                              onClose();
                            }}
                            className="flex-1 cursor-pointer rounded-xl border border-emerald-400/40 bg-emerald-500/20 py-1.5 font-mono text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/30"
                          >
                            Enter Inside
                          </button>
                        ) : (
                          <button
                            disabled={!canBuy}
                            onClick={() => onBuyApartment?.(apt.id)}
                            className={`flex-1 cursor-pointer rounded-xl border py-1.5 font-mono text-[10px] font-bold ${
                              canBuy
                                ? "border-amber-400 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                                : "cursor-not-allowed border-white/10 bg-white/5 text-white/35"
                            }`}
                          >
                            Buy ({apt.price})
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ---------------- SNAPMATIC CAMERA APP ---------------- */}
            {app === "snapmatic" && (
              <div className="space-y-3">
                <button
                  onClick={handleSnapmatic}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-600 py-2.5 text-xs font-bold text-white shadow-lg hover:brightness-110"
                >
                  <Camera className="size-4" />
                  Take Snapmatic Photo
                </button>
                {snaps.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/15 py-10 text-center text-[11px] text-white/45">
                    No photos yet. Capture your Safehouse, supercar, or Westgate Bay skyline.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snaps.map((s) => (
                      <div key={s.id} className="overflow-hidden rounded-2xl border border-white/15 bg-black/50">
                        <img src={s.dataUrl} alt={s.district} className="h-32 w-full object-cover" />
                        <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px]">
                          <div>
                            <div className="font-semibold text-white">{s.district}</div>
                            <div className="text-[9px] text-white/50">{s.timeLabel}</div>
                          </div>
                          <button
                            onClick={() => handleDeleteSnap(s.id)}
                            className="cursor-pointer rounded-lg p-1 text-white/45 hover:bg-white/10 hover:text-rose-400"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---------------- SKYOS ENVIRONMENT APP ---------------- */}
            {app === "skyos" && (
              <div className="space-y-3">
                <div>
                  <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-white/60">
                    Time of Day
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {TIME_OF_DAY_MODES.map((m: TimeOfDayMode) => (
                      <button
                        key={m}
                        onClick={() => gameRef.current?.setTimeOfDay(m)}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-semibold ${
                          hud.timeOfDay === m
                            ? "border-amber-400 bg-amber-500/20 text-amber-300"
                            : "border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10"
                        }`}
                      >
                        {m === "afternoon" && <Sun className="size-3.5" />}
                        {m === "sunset" && <Sunset className="size-3.5" />}
                        {m === "night" && <Moon className="size-3.5" />}
                        {m === "dawn" && <Sunrise className="size-3.5" />}
                        <span>{TIME_OF_DAY_LABELS[m]}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-wider text-white/60">
                    Atmosphere & Grip
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {WEATHER_MODES.map((wm: WeatherMode) => (
                      <button
                        key={wm}
                        onClick={() => gameRef.current?.setWeatherMode(wm)}
                        className={`flex cursor-pointer items-center gap-1.5 rounded-xl border px-2.5 py-2 text-[11px] font-semibold uppercase ${
                          hud.weatherMode === wm
                            ? "border-sky-400 bg-sky-500/20 text-sky-300"
                            : "border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/10"
                        }`}
                      >
                        {wm === "rain" ? (
                          <CloudRain className="size-3.5" />
                        ) : wm === "snow" ? (
                          <CloudSnow className="size-3.5" />
                        ) : (
                          <Compass className="size-3.5" />
                        )}
                        <span>{wm}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- OPERATIVE VITALS APP ---------------- */}
            {app === "vitals" && (
              <div className="space-y-2.5">
                <div className="rounded-2xl border border-teal-400/30 bg-teal-500/10 p-3">
                  <div className="flex items-center gap-2">
                    <UserCheck className="size-4 text-teal-300" />
                    <span className="text-xs font-bold text-white">Voss Field Operative</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px]">
                    <div className="rounded-xl bg-black/35 p-2">
                      <div className="text-white/50">VITALS</div>
                      <div className="text-sm font-bold text-teal-300">
                        {Math.round(hud.health)}/{hud.maxHealth}
                      </div>
                    </div>
                    <div className="rounded-xl bg-black/35 p-2">
                      <div className="text-white/50">CREDITS</div>
                      <div className="text-sm font-bold text-amber-300">{hud.credits}</div>
                    </div>
                    <div className="rounded-xl bg-black/35 p-2">
                      <div className="text-white/50">STEALTH</div>
                      <div className="text-sm font-bold text-white">{hud.stealthKills}</div>
                    </div>
                    <div className="rounded-xl bg-black/35 p-2">
                      <div className="text-white/50">ALERTS</div>
                      <div className="text-sm font-bold text-rose-400">{hud.alerts}</div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => gameRef.current?.toggleHolster()}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
                >
                  <span className="flex items-center gap-2">
                    <Crosshair className="size-3.5 text-[#38bdf8]" />
                    {hud.holstered ? "Draw Sidearm / Rifle" : "Holster Weapon"}
                  </span>
                  <span className="font-mono text-[10px] text-white/50">[H]</span>
                </button>

                <button
                  onClick={() => {
                    onClose();
                    gameRef.current?.setPaused(true);
                  }}
                  className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-white/15 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white hover:bg-white/10"
                >
                  <span className="flex items-center gap-2">
                    <Radio className="size-3.5 text-amber-400" />
                    System Command / Armory
                  </span>
                  <span className="font-mono text-[10px] text-white/50">[ESC]</span>
                </button>
              </div>
            )}
          </div>

          {/* Home Gesture Indicator */}
          <div className="relative z-10 flex justify-center pb-1.5 pt-1">
            <button
              onClick={() => (app === "home" ? onClose() : setApp("home"))}
              className="h-1 w-24 cursor-pointer rounded-full bg-white/35 transition hover:bg-white/70"
              title={app === "home" ? "Close Phone" : "Home"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function AppTile({
  icon,
  label,
  bg,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  bg: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex cursor-pointer flex-col items-center gap-1 text-center"
    >
      <div
        className={`flex size-12 items-center justify-center rounded-[15px] bg-gradient-to-br ${bg} shadow-md ring-1 ring-white/20 transition group-hover:scale-105 group-active:scale-95`}
      >
        {icon}
      </div>
      <span className="text-[9px] font-medium tracking-tight text-white/85">{label}</span>
    </button>
  );
}

function ContactCard({
  name,
  role,
  color,
  actionLabel,
  onAction,
}: {
  name: string;
  role: string;
  color: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${color} text-xs font-bold text-black`}>
          {name[0]}
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-white">{name}</div>
          <div className="truncate text-[10px] text-white/55">{role}</div>
        </div>
      </div>
      <button
        onClick={onAction}
        className="shrink-0 cursor-pointer rounded-xl bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/35"
      >
        {actionLabel}
      </button>
    </div>
  );
}
