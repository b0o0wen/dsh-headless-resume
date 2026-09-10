/**
 * @b0o0wen/dsh-headless-resume - headless runner with session resume.
 * Drop-in replacement for @deepseek-ai/dsh-headless that adds --resume.
 * After completion, stderr prints: dsh: session: <uuid>
 */

import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { brandString } from "@deepseek-ai/dsh-brand";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionSeq } from "@deepseek-ai/dsh-session";

const name = "headless-resume-runner";
const inject = ["agentDefaultModel", "agents", "sessions"];
const Config = z.object({
  task: z.string().required(),
  resume: z.string().optional()
});
const internals = { stdout: process.stdout, stderr: process.stderr };

function sessionUuid(id) {
  return String(id).replace(/^session-/, "");
}

function summarize(session, firstSeq) {
  let started = false;
  let text = "";
  let reason;
  const length = session.seq;
  for (let seq = firstSeq; seq < length; seq++) {
    const event = session.eventAt(SessionSeq(seq));
    if (event === void 0) continue;
    if (event.type === "turn/start") { started = true; continue; }
    if (!started) continue;
    if (event.type === "assistant/message") {
      const joined = event.data.message.content
        .filter((b) => b.type === "text").map((b) => b.text).join("");
      if (joined !== "") text = joined;
    }
    if (event.type === "turn/end") reason = event.data.reason;
  }
  return { text, reason };
}

function streamReasoning(ctx, agent, stderr) {
  let open = false;
  let nl = true;
  const close = () => {
    if (!open) return;
    if (!nl) stderr.write("\n");
    open = false; nl = true;
  };
  const dispose = ctx.on("agent/assistant-stream", ({ agent: s, frame }) => {
    if (s !== agent) return;
    if (frame.type === "start" || frame.type === "end") { close(); return; }
    const c = frame.chunk;
    if (c.type === "reasoning-delta") {
      if (c.text === "") return;
      if (!open) { stderr.write("dsh: reasoning:\n"); open = true; }
      stderr.write(c.text);
      nl = c.text.endsWith("\n");
    } else if (c.type === "block-start" || c.type === "block-end") {
      const bt = c.type === "block-start" ? c.blockType : c.block?.type;
      if (bt !== "reasoning") close();
    } else if (c.type !== "usage") {
      close();
    }
  });
  return () => { dispose(); close(); };
}

function fail(io, error) {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`);
  io.exit(1);
}

async function run(ctx, config, io) {
  await ctx.get("loader")?.await();
  const agents = ctx.get("agents");
  const defaultModel = ctx.get("agentDefaultModel");
  const sessions = ctx.get("sessions");
  if (!agents || !defaultModel || !sessions) return;

  const selection = defaultModel.currentSelection();
  const base = {
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (aCtx) => {
      installModelSelection(aCtx, { current: selection, assembled: void 0 });
    }
  };

  let agent;
  if (config.resume) {
    io.stderr.write(`dsh: resuming session ${config.resume}\n`);
    ({ agent } = await agents.resume({ ...base, resumeSessionId: brandString(config.resume) }));
  } else {
    ({ agent } = await agents.create({ ...base, sessionId: brandString(`session-${randomUUID()}`) }));
  }

  await agent.whenIdle();
  const firstSeq = agent.session.seq;
  const stop = streamReasoning(ctx, agent, io.stderr);
  try {
    agent.followup(createUserMessage({
      content: [{ type: "text", text: config.task }],
      source: { kind: "user" }
    }));
    await agent.whenIdle();
  } finally {
    stop();
  }
  await sessions.flush(agent.session);

  const uuid = sessionUuid(agent.session.id);
  io.stderr.write(`dsh: session: ${uuid}\n`);

  const outcome = summarize(agent.session, firstSeq);
  io.stdout.write(outcome.text + "\n");
  if (outcome.reason?.kind === "error") {
    io.stderr.write(`dsh: ${outcome.reason.error.code}: ${outcome.reason.error.message}\n`);
  }
  io.exit(outcome.reason?.kind === "completed" ? 0 : 1);
}

function apply(ctx, config) {
  const exit = ctx.get("appExit");
  if (exit === void 0) throw new Error("headless-resume-runner: ctx.appExit not available");
  const io = { stdout: internals.stdout, stderr: internals.stderr, exit };
  run(ctx, config, io).catch((e) => fail(io, e));
}

export { Config, apply, inject, internals, name };
