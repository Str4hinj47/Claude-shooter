import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import CarDoorViewer from "./viewer/CarDoorViewer";

// Default view is the car-door viewer (models + doors only).
// Append #game to the URL to load the full game instead.
const App = lazy(() => import("./App"));

const isGame = window.location.hash.startsWith("#game");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isGame ? (
      <Suspense fallback={<div className="bg-[#0b0d10]" />}>
        <App />
      </Suspense>
    ) : (
      <CarDoorViewer />
    )}
  </StrictMode>,
);
