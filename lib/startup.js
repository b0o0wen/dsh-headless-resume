import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";
const name = "headless-startup";
const inject = ["cmdlineArgs"];
const HEADLESS_STARTUP_SERVICE = "headlessStartup";
function apply(ctx) {
  const program = new Command()
    .name("dsh --profile headless-resume")
    .description("Answer one task (optionally resuming a session).")
    .helpOption("-h, --help", "show this help")
    .option("--resume <sessionId>", "resume the exact session ID printed by a previous run")
    .argument("[task...]", "the task text")
    .addHelpText("after", '\nExamples:\n  dsh --profile headless-resume "run the tests"\n  dsh --profile headless-resume --resume session-<uuid> "continue"\n');
  program.action(() => {
    const task = program.args.join(" ");
    const resume = program.opts().resume;
    if (resume !== undefined && resume.trim() === "") program.error('error: --resume requires a non-empty session ID');
    if (task.trim() === "") program.error('error: a task is required');
    ctx.provide(HEADLESS_STARTUP_SERVICE, { task, resume: resume ?? "" });
  });
  parseCmdline(ctx, program);
}
export { HEADLESS_STARTUP_SERVICE, apply, inject, name };
