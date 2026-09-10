/**
 * dsh-headless-resume — startup provider with --resume support.
 *
 * Replaces @deepseek-ai/dsh-headless/startup: adds --resume <id> option
 * to the Commander program and publishes it alongside the task.
 */

import { Command } from "commander";
import { parseCmdline } from "@deepseek-ai/dsh-cmdline";

const name = "headless-startup";
const inject = ["cmdlineArgs"];
const HEADLESS_STARTUP_SERVICE = "headlessStartup";

function headlessCommand() {
	return new Command()
		.name("dsh --profile headless-resume")
		.description("Answer one task (optionally resuming a session), print the final assistant message, and exit.")
		.helpOption("-h, --help", "show this help")
		.option("--resume <sessionId>", "resume a previous session by its UUID")
		.argument("[task...]", "the task text; multiple words are joined by spaces")
		.addHelpText("after", `
Examples:
  dsh --profile headless-resume "run the tests"
  dsh --profile headless-resume --resume <uuid> "continue from last time"
`);
}

function apply(ctx) {
	const program = headlessCommand();
	program.action(() => {
		const task = program.args.join(" ");
		const resume = program.opts().resume || undefined;
		if (task.trim() === "") program.error('error: a task is required, for example: dsh --profile headless-resume "run the tests"');
		ctx.provide(HEADLESS_STARTUP_SERVICE, { task, resume });
	});
	parseCmdline(ctx, program);
}

export { HEADLESS_STARTUP_SERVICE, apply, inject, name };
