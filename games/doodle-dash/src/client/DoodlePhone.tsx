import { Button, type GameClientProps } from "@party/ui";
import { useRef } from "react";
import type { DoodleAction, DoodleView } from "../rules";
import { CanvasView } from "./CanvasView";
import { DrawPad } from "./DrawPad";
import { useFitWord } from "./fitWord";
import { guessSendOptions } from "./guessSend";
import { Feed, GuessForm, Hint, PhaseTimer, Reveal, Waiting } from "./parts";
import { drawerSeesFeed } from "./phase";
import { useDoodleSounds } from "./useDoodleSounds";
import { useStrokes } from "./useStrokes";

export function DoodlePhone(p: GameClientProps<DoodleView>) {
  const { view, serverNow, mode, onEvent } = p;
  const send = (a: DoodleAction) => p.send(a, a.t === "guess" ? guessSendOptions(view) : undefined);
  const role = view.you?.role ?? "spectator";
  const isDrawer = role === "drawer";
  const [strokes, setStrokes, activity] = useStrokes(view, onEvent, isDrawer && view.phase === "drawing");
  useDoodleSounds(view, p.soundOn, serverNow);
  const me = view.players.find((x) => x.id === p.you.id);
  const drawer = view.players.find((x) => x.id === view.drawerId);
  const showCanvas = mode === "phones";
  const waiting = view.waiting === true;
  const secretRef = useRef<HTMLParagraphElement>(null);
  useFitWord(secretRef, isDrawer && view.phase === "drawing" ? `${view.turnKey}|${view.word ?? ""}` : null);

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
      <div className="phone dd-phone dd-phone-choose">
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
    // Phones-only: no TV to watch guesses on, so the drawer gets a compact feed (doodle.css fits
    // it above or beside the canvas). It is the drawer's own view.feed, so it shows nothing new.
    const withFeed = drawerSeesFeed(mode);
    return (
      <div className={`phone dd-phone dd-phone-draw${withFeed ? " dd-phone-draw-feed" : ""}`}>
        {header}
        <p className="dd-secret" ref={secretRef}><span className="dd-secret-label">Draw: </span><strong data-testid="secret-word">{view.word}</strong></p>
        {withFeed && <Feed items={view.feed} players={view.players} compact youId={p.you.id} />}
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
      <Feed items={view.feed} players={view.players} compact youId={p.you.id} />
      {!isDrawer && <GuessForm placeholder={solved ? "Chat with players who got it" : "Type your guess"} onSubmit={(text) => send({ t: "guess", text })} />}
    </div>
  );
}
