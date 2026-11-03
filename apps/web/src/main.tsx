import "@party/ui";
import "./app.css";
import { Button } from "@party/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./lib/ErrorBoundary";
import { Fatal } from "./pages/Fatal";

/** Last line of defence: a render crash anywhere shows a way out instead of a blank page. */
const crashed = (
  <Fatal
    message="Something went wrong."
    action={<Button size="lg" onClick={() => location.reload()}>Reload</Button>}
  />
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary fallback={crashed}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
