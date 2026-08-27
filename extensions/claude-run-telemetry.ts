import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	formatAnimatedWorkingMessage,
	formatWorkingMessage,
	getStreamDeltaLength,
	pickCompletionVerb,
	pickWorkingVerb,
} from "./render-utils.ts";

export type RunMetricsEntry = {
	durationMs: number;
	completionVerb?: string;
};

type AssistantStreamEvent = {
	type: string;
	delta?: unknown;
};

type AssistantMessage = {
	content: unknown;
};

function getResponseLength(message: AssistantMessage): number {
	if (!Array.isArray(message.content)) return 0;
	return message.content.reduce((total, block) => {
		if (!block || typeof block !== "object") return total;
		if ("text" in block && typeof block.text === "string") return total + block.text.length;
		if ("thinking" in block && typeof block.thinking === "string") return total + block.thinking.length;
		if ("type" in block && block.type === "toolCall" && "arguments" in block) {
			return total + (JSON.stringify(block.arguments)?.length ?? 0);
		}
		return total;
	}, 0);
}

export class ClaudeRunTelemetry {
	private refreshTimer: NodeJS.Timeout | undefined;
	private context: ExtensionContext | undefined;
	private startedAt: number | undefined;
	private completedResponseLength = 0;
	private streamingResponseLength = 0;
	private thinkingActive = false;
	private workingVerb = "Thinking";

	start(ctx: ExtensionContext, reset: boolean): void {
		if (!reset && this.startedAt !== undefined) {
			this.context = ctx;
			return;
		}

		this.clearTimer();
		this.context?.ui.setWorkingMessage(undefined);
		this.context = ctx;
		if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
		this.startedAt = Date.now();
		this.completedResponseLength = 0;
		this.streamingResponseLength = 0;
		this.thinkingActive = false;
		this.workingVerb = pickWorkingVerb();
		this.updateWorkingMessage();

		this.refreshTimer = setInterval(() => this.updateWorkingMessage(), 200);
		this.refreshTimer.unref?.();
	}

	stop(ctx?: ExtensionContext): RunMetricsEntry | undefined {
		this.clearTimer();
		const activeContext = this.context ?? ctx;
		if (activeContext?.mode === "tui") {
			activeContext.ui.setWorkingMessage(undefined);
			activeContext.ui.setWorkingVisible(true);
		}
		if (this.startedAt === undefined) {
			this.context = undefined;
			return undefined;
		}

		const metrics = {
			durationMs: Date.now() - this.startedAt,
			completionVerb: pickCompletionVerb(),
		};
		this.context = undefined;
		this.startedAt = undefined;
		this.completedResponseLength = 0;
		this.streamingResponseLength = 0;
		this.thinkingActive = false;
		return metrics;
	}

	onStream(event: AssistantStreamEvent, ctx: ExtensionContext): void {
		this.streamingResponseLength += getStreamDeltaLength(event);
		const delta = (
			event.type === "thinking_delta"
			|| event.type === "text_delta"
			|| event.type === "toolcall_delta"
		) && typeof event.delta === "string"
			? event.delta
			: "";
		if (event.type === "thinking_delta" && delta.trim().length > 0) {
			this.thinkingActive = true;
			if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
		} else if (event.type === "text_delta" && delta.trim().length > 0) {
			this.thinkingActive = false;
			if (ctx.mode === "tui") ctx.ui.setWorkingVisible(false);
		} else if (event.type === "toolcall_delta") {
			this.thinkingActive = false;
		}
		this.updateWorkingMessage();
	}

	onMessageEnd(message: AssistantMessage): void {
		this.completedResponseLength += Math.max(this.streamingResponseLength, getResponseLength(message));
		this.streamingResponseLength = 0;
		this.updateWorkingMessage();
	}

	showWorking(ctx: ExtensionContext): void {
		this.thinkingActive = false;
		if (ctx.mode === "tui") ctx.ui.setWorkingVisible(true);
	}

	private clearTimer(): void {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = undefined;
	}

	private updateWorkingMessage(): void {
		if (this.context?.mode !== "tui" || this.startedAt === undefined) return;
		const elapsedMs = Date.now() - this.startedAt;
		const message = formatWorkingMessage(
			this.workingVerb,
			elapsedMs,
			this.completedResponseLength + this.streamingResponseLength,
			false,
			this.thinkingActive ? this.context.thinkingLevel : undefined,
		);
		this.context.ui.setWorkingMessage(formatAnimatedWorkingMessage(message, elapsedMs));
	}
}
