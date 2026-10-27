type Output = { write(value: string): unknown };
export type TerminalChoice = { kind: "selected"; values: number[] } | { kind: "manual" } | { kind: "cancelled" };
/** Local non-secret choices only. No readline may be attached while raw input is active. */
export function readTerminalChoice(input: NodeJS.ReadStream, output: Output, question: string, labels: readonly string[], multi = false, manual = true): Promise<TerminalChoice> {
  if (!input.isTTY || typeof input.setRawMode !== "function" || labels.length < 1 || labels.length > 12) return Promise.reject(new Error("setup_requires_interactive_terminal"));
  return new Promise((resolve, reject) => {
    let cursor = 0, finished = false, rendered = false, pending = "";
    const wasRaw = input.isRaw, selected = new Set<number>();
    const items = manual ? [...labels, "직접 입력"] : [...labels];
    const draw = () => {
      if (rendered) output.write(`\x1b[${items.length + 1}A`);
      output.write(`\r\x1b[2K${question} (↑↓ 선택${multi ? ", Space 복수 선택" : ""}, Enter 확인, Ctrl+C 중단)\n`);
      items.forEach((label, i) => output.write(`\r\x1b[2K${cursor === i ? ">" : " "} ${multi && i < labels.length ? (selected.has(i) ? "[x] " : "[ ] ") : ""}${label}\n`));
      rendered = true;
    };
    const finish = (result: TerminalChoice, failed = false) => {
      if (finished) return; finished = true;
      input.removeListener("data", onData); input.removeListener("end", onEnd); input.removeListener("error", onError);
      try { input.setRawMode(wasRaw); } catch { failed = true; }
      input.pause(); pending = ""; output.write("\x1b[?25h");
      if (failed) reject(new Error("setup_failed")); else resolve(result);
    };
    const onEnd = () => finish({ kind: "cancelled" });
    const onError = () => finish({ kind: "cancelled" }, true);
    const onData = (chunk: Buffer | string) => {
      pending += chunk.toString();
      while (pending && !finished) {
        if (pending[0] === "\x1b") {
          if (pending.length < 3 && "\x1b[".startsWith(pending)) break;
          const sequence = pending.slice(0, 3); pending = pending.slice(3);
          if (sequence === "\x1b[A") cursor = (cursor + items.length - 1) % items.length;
          else if (sequence === "\x1b[B") cursor = (cursor + 1) % items.length;
          else { finish({kind:"cancelled"}); break; }
          draw(); continue;
        }
        const char = pending[0]!; pending = pending.slice(1);
        if (char === "\x03" || char === "\x04") { finish({ kind: "cancelled" }); break; }
        if (char === " " && multi && cursor < labels.length) { selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor); draw(); }
        if (char === "\r" || char === "\n") {
          if (manual && cursor === labels.length) finish({ kind: "manual" });
          else { if (!multi || selected.size === 0) selected.add(cursor); finish({ kind: "selected", values: [...selected].sort((a,b) => a-b) }); }
          break;
        }
      }
      // Ignore pasted unrecognized text; never echo or retain it as an answer.
      if (pending.length > 4) { pending = ""; finish({kind:"cancelled"}); }
    };
    try { output.write("\x1b[?25l"); draw(); input.setRawMode(true); input.on("data", onData); input.on("end", onEnd); input.on("error", onError); input.resume(); }
    catch { finish({ kind: "cancelled" }, true); }
  });
}
