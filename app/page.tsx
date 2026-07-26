import FileWorkbench from "@/components/FileWorkbench";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">file</h1>
        <p className="mt-2 text-muted">
          Open a spreadsheet, document or data file without installing anything.
          Formats marked <span className="text-accent">●</span> are read entirely
          in your browser — those files never leave your device.
        </p>
      </header>

      <FileWorkbench />

      <footer className="mt-10 border-t border-line pt-6 text-xs text-muted">
        Nothing is stored. Files sent to the server for conversion are held in
        memory for the length of the request and then discarded.
      </footer>
    </main>
  );
}
