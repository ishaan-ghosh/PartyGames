import { Button, type GameClientProps } from "@party/ui";
import type { DoodleAction, DoodleView } from "../rules";
import { CanvasView } from "./CanvasView";
import { DrawPad } from "./DrawPad";
import { Feed, GuessForm, Hint, PhaseTimer, Reveal, Waiting } from "./parts";
import { useDoodleSounds } from "./useDoodleSounds";
import { useStrokes } from "./useStrokes";

export function DoodlePhone(p: GameClientProps<DoodleView>) {
  const { view, serverNow, mode, onEvent } = p;
  const send = (a: DoodleAction) => p.send(a);
  const role = view.you?.role ?? "spectator";
  const isDrawer = role === "drawer";
  const [strokes, setStrokes, activity] = useStrokes(view, onEvent, isDrawer && view.phase === "drawing");
  useDoodleSounds(view, p.soundOn, serverNow);
  const me = view.players.find((x) => x.id === p.you.id);
  const drawer = view.players.find((x) => x.id === view.drawerId);
  const showCanvas = mode === "phones";
  const waiting = view.waiting === true;

  const header = (
    <header className="dd-phone-top">
      <span className="dd-round">R{view.round}/{view.rounds}</span>
      <span className="dd-myscore">⭐ <span data-testid="my-score">{me?.score ?? 0}</span></span>
      <PhaseTimer view={view} serverNow={serverNow} size={52} />
    </header>
  );

  if (role === "spectator") {
    return (
      <div className="phone dd-phone">
        {header}
        <p className="dd-note">You joined mid-game. You'll be in the next one!</p>
        {waiting && <Waiting view={view} />}
        {showCanvas && <CanvasView strokes={strokes} testId="phone-canvas" />}
      </div>
    );
  }

  if (isDrawer && view.phase === "choosing") {
    return (
      <div className="phone dd-phone">
        {header}
        <h2 className="dd-title">Pick a word to draw</h2>
        <div className="dd-choices">
          {view.choices?.map((w, i) => (
            <Button key={w} size="xl" variant="secondary" data-testid="word-choice" onClick={() => send({ t: "choose", index: i })}>{w}</Button>
          ))}
        </div>
      </div>
    );
  }

  if (isDrawer && view.phase === "drawing") {
    return (
      <div className="phone dd-phone dd-phone-draw">
        {header}
        <p className="dd-secret">Draw: <strong data-testid="secret-word">{view.word}</strong></p>
        <DrawPad strokes={strokes} setStrokes={setStrokes} send={send} activity={activity} fillsLeft={view.fillsLeft} />
      </div>
    );
  }

  const solved = role === "solver";
  return (
    <div className="phone dd-phone">
      {header}
      {waiting && <Waiting view={view} />}
      {view.phase === "choosing" && <p className="dd-note">{drawer?.name ?? "Someone"} is choosing a word…</p>}
      {showCanvas && (
        <div className="dd-canvas-wrap">
          <CanvasView strokes={strokes} testId="phone-canvas" />
          {view.phase === "reveal" && !waiting && <Reveal view={view} />}
        </div>
      )}
      {!showCanvas && view.phase === "reveal" && !waiting && (
        <p className="dd-note">The word was <strong>{view.word}</strong></p>
      )}
      {view.phase === "drawing" && <Hint hint={view.hint} />}
      {solved && view.phase === "drawing" && <div className="dd-solved">✅ You got it! +{me?.turnPoints ?? 0}</div>}
      <Feed items={view.feed} players={view.players} compact />
      {!isDrawer && <GuessForm placeholder={solved ? "Chat with players who got it" : "Type your guess"} onSubmit={(text) => send({ t: "guess", text })} />}
    </div>
  );
}
