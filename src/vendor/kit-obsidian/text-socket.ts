// vendored from obsidian-kit@0.69.1, src/obsidian/text-socket.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Ein WebSocket im Renderer, der nur Textrahmen weiterreicht — der Transport, den ein Plugin für einen Fortschritts- oder Ereignisstrom braucht
 *  (ComfyUI meldet Schritte per WebSocket, `local-image-generator`). Reiner Transport: welche Nachricht was heißt, liest der Aufrufer.
 *
 *  Herkunft: `local-image-generator/src/obsidian/comfy-progress.ts` (`openComfyProgressSocket`, 2026-10-17); das Bibliothek-Gate fand weder im Kit noch in
 *  code-kit einen Treffer. Unterschiede zur Vorlage (begründet): `onOpen` und `onClose` sind dazugekommen — ein zweiter Nutzer, der nach einem
 *  Abbruch neu verbindet oder „verbunden“ anzeigt, braucht beides. **Ein `onError` gibt es nicht:** der Browser meldet einen Fehler ohne Inhalt und
 *  beendet die Verbindung danach immer mit `close`; `onClose` deckt ihn ab. Und ein Konstruktorfehler (eine ungültige Adresse wirft) ist hier kein Wurf,
 *  sondern ein sofortiges `onClose`.
 *
 *  Verhalten:
 *  - Der Konstruktor kommt von `activeWindow` (dem Fenster, in dem das Panel liegt, wie `activeWindow.fetch`; Obsidians Typ kennt `WebSocket` dort nicht).
 *  - Textrahmen gehen an `onMessage`, Binärrahmen (Vorschaubilder) werden ignoriert.
 *  - Fehler und Ende sind erwartet (403 beim Handshake, Server weg): nichts wird gemeldet oder geworfen außer über `onClose`.
 *  - `onClose` kommt höchstens einmal und **nur, wenn die Gegenseite oder das Netz schließt** — nicht nach dem eigenen `close()` (sonst baute ein
 *    Wiederverbinden darauf eine Schleife). Nach `close()` kommt gar kein Rückruf mehr.
 *  - `close()` ist idempotent und wirft nie. */
export interface TextSocketOptions {
  /** Die Verbindung steht. */
  onOpen?: () => void;
  /** Die Verbindung ist zu oder kam nie zustande (Handshake abgelehnt, Server weg, ungültige Adresse). Höchstens einmal, nie nach dem eigenen `close()`. */
  onClose?: () => void;
}

export interface TextSocket { close(): void }

export function openTextSocket(url: string, onMessage: (data: string) => void, opts: TextSocketOptions = {}): TextSocket {
  let done = false;      // close() gerufen
  let closedSignalled = false;
  const signalClosed = (): void => {
    if (done || closedSignalled) return;
    closedSignalled = true;
    opts.onClose?.();
  };

  let ws: WebSocket;
  try {
    const WS = (activeWindow as unknown as { WebSocket: typeof WebSocket }).WebSocket;
    ws = new WS(url);
  } catch {
    signalClosed();
    return { close: () => { done = true; } };
  }
  ws.addEventListener("open", () => { if (!done) opts.onOpen?.(); });
  ws.addEventListener("message", (ev: MessageEvent) => {
    if (!done && typeof ev.data === "string") onMessage(ev.data);
  });
  // Ein Fehler ist erwartet und trägt nichts; das `close` danach meldet ihn.
  ws.addEventListener("error", () => { /* siehe Kopf: onClose deckt ihn ab */ });
  ws.addEventListener("close", signalClosed);
  return {
    close: () => {
      if (done) return;
      done = true;
      try { ws.close(); } catch { /* schon zu */ }
    },
  };
}
