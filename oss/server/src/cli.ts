#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runSetup, type SetupAction } from "./setup-cli.js";

export async function dispatchGooseCommand(args: string[], action: (mode: SetupAction) => Promise<number> = runSetup, errors: { write(value: string): unknown } = process.stderr): Promise<number> {
  const commands = args[0] === "/goose" ? args.slice(1) : args;
  if (commands[0] === "setup" && commands.length <= 2) {
    const flag = commands[1];
    if (flag === undefined) return action("reuse");
    if (flag === "--edit-profile") return action("edit");
    if (flag === "--delete-profile") return action("delete");
  }
  // Never echo arbitrary argv: callers sometimes mistakenly pass a secret there.
  errors.write("usage: moai-atp [ /goose ] setup [--edit-profile|--delete-profile]\n"); return 64;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void dispatchGooseCommand(process.argv.slice(2)).then(code => { process.exitCode = code; }, () => { process.stderr.write("command_failed\n"); process.exitCode = 2; });
}
