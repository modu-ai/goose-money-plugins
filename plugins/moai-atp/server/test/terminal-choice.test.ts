import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readTerminalChoice } from "../src/terminal-choice.js";
class TTY extends EventEmitter {
  isTTY = true; isRaw = false; paused = false;
  setRawMode(value: boolean) { this.isRaw = value; return this; }
  resume() { this.paused = false; return this; }
  pause() { this.paused = true; return this; }
}
function start(multi = false, manual = true) {
  const input = new TTY(); let text = "";
  const promise = readTerminalChoice(input as unknown as NodeJS.ReadStream, {write(value) {text += value;}}, "한 질문", ["첫 선택", "둘째 선택"], multi, manual);
  return {input, promise, text: () => text};
}
test("default waits for Enter; fragmented arrow sequences select correctly and restore terminal", async () => {
  const t = start(); let done = false; void t.promise.then(() => {done=true;}); await Promise.resolve(); assert.equal(done,false);
  t.input.emit("data", "\x1b["); t.input.emit("data", "B"); t.input.emit("data", "\r");
  assert.deepEqual(await t.promise, {kind:"selected",values:[1]});
  assert.equal(t.input.isRaw,false); assert.equal(t.input.paused,true); assert.equal(t.input.listenerCount("data"),0);
  assert.match(t.text(), /\x1b\[\?25h$/);
});
test("multi selection preserves original option order and the last option is manual input", async () => {
  const t=start(true); t.input.emit("data", " \x1b[B \r"); assert.deepEqual(await t.promise,{kind:"selected",values:[0,1]});
  const m=start(); m.input.emit("data", "\x1b[A\r"); assert.deepEqual(await m.promise,{kind:"manual"});
});
test("cancel and EOF remove raw input listeners without submitting the default", async () => {
  for(const event of ["\x03", "\x04"]) {const t=start();t.input.emit("data",event);assert.deepEqual(await t.promise,{kind:"cancelled"});assert.equal(t.input.listenerCount("data"),0);}
  const t=start(); t.input.emit("end"); assert.deepEqual(await t.promise,{kind:"cancelled"}); assert.equal(t.input.isRaw,false);
});
test("menu does not echo pasted text; pipes are rejected", async () => {
  const t=start();t.input.emit("data","SYNTHETIC_SECRET");t.input.emit("data","\x03");await t.promise;assert.doesNotMatch(t.text(),/SYNTHETIC_SECRET/);
  const input=new TTY();input.isTTY=false;await assert.rejects(readTerminalChoice(input as unknown as NodeJS.ReadStream,{write(){}},"q",["a"]),/setup_requires_interactive_terminal/);
});
