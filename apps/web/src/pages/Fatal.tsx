export function Fatal({ message }: { message: string }) {
  return (
    <main className="center">
      <div className="card fatal">
        <p className="fatal-emoji" aria-hidden>🫠</p>
        <h1>{message}</h1>
        <a className="btn btn-primary btn-lg" href="/">Back to start</a>
      </div>
    </main>
  );
}
