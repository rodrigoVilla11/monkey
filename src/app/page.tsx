export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="text-5xl" aria-hidden>
        🐒
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Monkey</h1>
      <p className="text-sm text-muted-foreground">
        Incremento 1 — configuración del proyecto.
      </p>
    </main>
  );
}
