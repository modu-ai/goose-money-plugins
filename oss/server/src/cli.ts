#!/usr/bin/env node
import {planGooseRequest} from './goose-routing.js';
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { runSetup, type SetupAction } from "./setup-cli.js";
import { runCredentialSetup } from "./credential-setup.js";

export async function dispatchGooseCommand(args: string[], action: (mode: SetupAction) => Promise<number> = runSetup, errors: { write(value: string): unknown } = process.stderr, credentials: () => Promise<number> = runCredentialSetup, output: {write(value:string):unknown} = process.stdout): Promise<number> {
  const commands = args[0] === "/goose" ? args.slice(1) : args;
  if (commands[0] === "setup" && commands.length <= 2) {
    const flag = commands[1];
    if (flag === undefined) {
      const result = await action("reuse");
      return result === 0 ? credentials() : result;
    }
    if (flag === "--edit-profile") return action("edit");
    if (flag === "--delete-profile") return action("delete");
    if (flag === "--credentials") return credentials();
  }
  if(commands.length&&commands[0]!=='setup'){
    const plan=planGooseRequest(commands.join(' '));
    if(plan.status!=='clarification_required'){output.write(JSON.stringify(plan)+'\n');return plan.status==='ready'?0:64;}
  }
  // Never echo arbitrary argv: callers sometimes mistakenly pass a secret there.
  errors.write("usage: moai-atp [ /goose ] setup [--edit-profile|--delete-profile|--credentials]\n"); return 64;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void dispatchGooseCommand(process.argv.slice(2)).then(code => { process.exitCode = code; }, () => { process.stderr.write("command_failed\n"); process.exitCode = 2; });
}
