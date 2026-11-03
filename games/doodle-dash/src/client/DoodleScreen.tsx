import { PlayerChip, type GameClientProps } from "@party/ui";
import type { DoodleView } from "../rules";
import { CanvasView } from "./CanvasView";
import { Feed, Hint, PhaseTimer, Reveal, Scoreboard, Waiting } from "./parts";
import { useDoodleSounds } from "./useDoodleSounds";
import { useStrokes } from "./useStrokes";

export { phaseTotal } from "./phase";

export function DoodleScreen(p: GameClientProps<DoodleView>) {
  const { view, serverNow, onEvent } = p;
  const [strokes] = useStrokes(view, onEvent, false, p.resync);
  useDoodleSounds(view, p.soundOn, serverNow);
  const drawer = view.players.find((x) => x.id === view.drawerId);
  return (
    <div className="dd-screen">
      <header className="dd-top">
        <span className="dd-round">Round {view.round} / {view.rounds}</span>
        <Hint hint={view.hint} big />
        <PhaseTimer view={view} serverNow={serverNow} size={88} />
      </header>
      <div className="dd-stage">
        <div className="dd-canvas-cell">
          <div className="dd-canvas-wrap">
            <CanvasView strokes={strokes} testId="screen-canvas" />
            {view.phase === "choosing" && drawer && (
              <div className="dd-overlay">
                <PlayerChip size="lg" name={drawer.name} avatar={drawer.avatar} />
                <p>is choosing a word…</p>
              </div>
            )}
            {view.phase === "reveal" && (view.waiting ? <Waiting view={view} overlay /> : <Reveal view={view} />)}
          </div>
        </div>
        <aside className="dd-side">
          <Scoreboard view={view} />
          <Feed items={view.feed} players={view.players} />
        </aside>
      </div>
    </div>
  );
}
