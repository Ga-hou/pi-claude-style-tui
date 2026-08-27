import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	advanceAnimatedResponseLength,
	advanceStalledIntensity,
	formatAnimatedWorkingMessage,
	formatWorkingMessage,
	getStreamDeltaLength,
	pickCompletionVerb,
	pickWorkingVerb,
	type WorkingAnimationMode,
} from "./render-utils.ts";

const ANIMATION_REFRESH_INTERVAL_MS = 50;
const REDUCED_MOTION_REFRESH_INTERVAL_MS = 1_000;

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
	usage?: {
		output?: number;
	};
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
	private targetResponseLength = 0;
	private displayedResponseLength = 0;
	private thinkingActive = false;
	private thinkingStartedAt: number | undefined;
	private tokenDirection: "up" | "down" = "up";
	private mode: WorkingAnimationMode = "requesting";
	private workingVerb = "Thinking";
	private workingVisible = false;
	private reducedMotion = false;
	private lastProgressAt = 0;
	private stalledIntensity = 0;
	private readonly activeToolCalls = new Set<string>();

	setReducedMotion(reducedMotion: boolean): void {
		if (this.reducedMotion === reducedMotion) return;
		this.reducedMotion = reducedMotion;
		if (reducedMotion) this.displayedResponseLength = this.targetResponseLength;
		if (this.startedAt !== undefined && this.workingVisible) {
			this.clearTimer();
			this.startTimer();
			this.updateWorkingMessage();
		}
	}

	start(ctx: ExtensionContext, reset: boolean): void {
		if (!reset && this.startedAt !== undefined) {
			this.context = ctx;
			return;
		}

		this.clearTimer();
		this.context?.ui.setWorkingMessage(undefined);
		this.context = ctx;
		this.startedAt = Date.now();
		this.completedResponseLength = 0;
		this.streamingResponseLength = 0;
		this.targetResponseLength = 0;
		this.displayedResponseLength = 0;
		this.thinkingActive = false;
		this.thinkingStartedAt = undefined;
		this.tokenDirection = "up";
		this.mode = "requesting";
		this.workingVerb = pickWorkingVerb();
		this.lastProgressAt = this.startedAt;
		this.stalledIntensity = 0;
		this.activeToolCalls.clear();
		this.setWorkingVisibility(ctx, true);
		this.updateWorkingMessage();
	}

	stop(ctx?: ExtensionContext): RunMetricsEntry | undefined {
		this.clearTimer();
		const activeContext = this.context ?? ctx;
		if (activeContext?.mode === "tui") {
			activeContext.ui.setWorkingMessage(undefined);
			activeContext.ui.setWorkingVisible(true);
		}
		this.workingVisible = false;
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
		this.targetResponseLength = 0;
		this.displayedResponseLength = 0;
		this.thinkingActive = false;
		this.thinkingStartedAt = undefined;
		this.tokenDirection = "up";
		this.mode = "requesting";
		this.lastProgressAt = 0;
		this.stalledIntensity = 0;
		this.activeToolCalls.clear();
		return metrics;
	}

	onStream(event: AssistantStreamEvent, ctx: ExtensionContext): void {
		const previousMode = this.mode;
		const wasVisible = this.workingVisible;
		const deltaLength = getStreamDeltaLength(event);
		if (deltaLength > 0) {
			this.streamingResponseLength += deltaLength;
			this.lastProgressAt = Date.now();
			this.stalledIntensity = 0;
		}
		this.tokenDirection = "down";
		const delta = typeof event.delta === "string" ? event.delta : "";

		if (event.type === "thinking_delta" && delta.trim().length > 0) {
			if (!this.thinkingActive) this.thinkingStartedAt = Date.now();
			this.thinkingActive = true;
			this.mode = "thinking";
			this.setWorkingVisibility(ctx, true);
		} else if (event.type === "text_delta" && delta.trim().length > 0) {
			this.thinkingActive = false;
			this.thinkingStartedAt = undefined;
			this.mode = "responding";
			this.setWorkingVisibility(ctx, false);
		} else if (event.type === "toolcall_delta") {
			this.thinkingActive = false;
			this.thinkingStartedAt = undefined;
			this.mode = "responding";
			this.setWorkingVisibility(ctx, true);
		}

		if (this.workingVisible && (!wasVisible || previousMode !== this.mode)) this.updateWorkingMessage();
	}

	onMessageEnd(message: AssistantMessage): void {
		const measuredResponseLength = Math.max(this.streamingResponseLength, getResponseLength(message));
		const actualOutputTokens = message.usage?.output;
		this.completedResponseLength +=
			typeof actualOutputTokens === "number" && actualOutputTokens >= 0
				? actualOutputTokens * 4
				: measuredResponseLength;
		this.streamingResponseLength = 0;
		this.targetResponseLength = Math.max(this.targetResponseLength, this.completedResponseLength);
	}

	showWorking(ctx: ExtensionContext, tokenDirection: "up" | "down"): void {
		this.thinkingActive = false;
		this.thinkingStartedAt = undefined;
		this.tokenDirection = tokenDirection;
		this.mode = tokenDirection === "up" ? "requesting" : "responding";
		this.lastProgressAt = Date.now();
		this.stalledIntensity = 0;
		this.setWorkingVisibility(ctx, true);
		this.updateWorkingMessage();
	}

	onToolStart(toolCallId: string, ctx: ExtensionContext): void {
		this.activeToolCalls.add(toolCallId);
		this.thinkingActive = false;
		this.thinkingStartedAt = undefined;
		this.tokenDirection = "down";
		this.mode = "tool-use";
		this.lastProgressAt = Date.now();
		this.stalledIntensity = 0;
		this.setWorkingVisibility(ctx, true);
		this.updateWorkingMessage();
	}

	onToolEnd(toolCallId: string): void {
		this.activeToolCalls.delete(toolCallId);
		if (this.activeToolCalls.size === 0) this.lastProgressAt = Date.now();
	}

	private setWorkingVisibility(ctx: ExtensionContext, visible: boolean): void {
		if (ctx.mode !== "tui") return;
		ctx.ui.setWorkingVisible(visible);
		if (this.workingVisible === visible) return;
		this.workingVisible = visible;
		if (visible) this.startTimer();
		else this.clearTimer();
	}

	private startTimer(): void {
		if (this.refreshTimer || this.startedAt === undefined || !this.workingVisible) return;
		const interval = this.reducedMotion ? REDUCED_MOTION_REFRESH_INTERVAL_MS : ANIMATION_REFRESH_INTERVAL_MS;
		this.refreshTimer = setInterval(() => this.updateWorkingMessage(true), interval);
		this.refreshTimer.unref?.();
	}

	private clearTimer(): void {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = undefined;
	}

	private updateWorkingMessage(advanceFrame = false): void {
		if (this.context?.mode !== "tui" || this.startedAt === undefined || !this.workingVisible) return;
		const now = Date.now();
		const elapsedMs = now - this.startedAt;
		this.targetResponseLength = Math.max(
			this.targetResponseLength,
			this.completedResponseLength + this.streamingResponseLength,
		);
		if (this.reducedMotion) this.displayedResponseLength = this.targetResponseLength;
		else if (advanceFrame) {
			this.displayedResponseLength = advanceAnimatedResponseLength(
				this.displayedResponseLength,
				this.targetResponseLength,
			);
		}

		if (advanceFrame || this.reducedMotion) {
			this.stalledIntensity = advanceStalledIntensity(
				this.stalledIntensity,
				now - this.lastProgressAt,
				this.activeToolCalls.size > 0,
				this.reducedMotion,
			);
		}

		const message = formatWorkingMessage(
			this.workingVerb,
			elapsedMs,
			this.displayedResponseLength,
			false,
			this.thinkingActive ? this.context.thinkingLevel : undefined,
			this.tokenDirection,
		);
		this.context.ui.setWorkingMessage(
			formatAnimatedWorkingMessage(message, elapsedMs, this.context.ui.theme, {
				mode: this.mode,
				stalledIntensity: this.stalledIntensity,
				thinkingElapsedMs:
					this.thinkingActive && this.thinkingStartedAt !== undefined ? now - this.thinkingStartedAt : undefined,
				reducedMotion: this.reducedMotion,
			}),
		);
	}
}
