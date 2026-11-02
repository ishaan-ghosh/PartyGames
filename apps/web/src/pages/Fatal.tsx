import type { ReactNode } from "react";

export function Fatal({ message, action }: { message: string; action?: ReactNode }) {
  return (
    <main className="center">
      <div className="card fatal">
        <p className="fatal-emoji" aria-hidden>🫠</p>
        <h1>{message}</h1>
        {action}
        <a className={`btn ${action ? "btn-secondary" : "btn-primary"} btn-lg`} href="/">Back to start</a>
      </div>
    </main>
  );
}
