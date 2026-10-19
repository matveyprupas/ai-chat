import { google } from '@ai-sdk/google';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APICallError, generateText, RetryError, stepCountIs } from 'ai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { BufferedMessage } from '../queue/message-buffer.types';
import {
  createOrderAgentTools,
  MIN_LEAD_DAYS,
  utcDatePlusDays,
} from './order-agent.tools';
import type { OrderCustomer, OrderState } from './order-state';
import { OrderStateService } from './order-state.service';

dayjs.extend(utc);

const MAX_TOOL_STEPS = 5;
const MODEL_ENV_KEYS = ['GEMINI_MODEL_1', 'GEMINI_MODEL_2', 'GEMINI_MODEL_3'];

const EMPTY_REPLY_FALLBACK =
  'Напишите ещё детали заказа, пожалуйста. / Please share a bit more order detail.';

function buildSystemPrompt(todayUtc: string, earliestDate: string): string {
  return `You are an order-intake assistant for a confectionery (cakes and desserts).

Clock (authoritative — do NOT use your training cutoff or guess the year):
- Today (UTC calendar date): ${todayUtc}
- Earliest bookable event date: ${earliestDate} (today + ${MIN_LEAD_DAYS} calendar days UTC)

Your job:
- Collect order details from the customer until the order is ready to submit.
- Reply in the language of the customer's latest messages.
- Be concise and friendly. Ask for missing essentials one or two at a time.

Checklist fields to collect:
- eventDate (YYYY-MM-DD) — always verify with check_date_availability before confirming
- weightKg
- flavorName and/or designDescription
- deliveryType (pickup | delivery) and deliveryAddress when delivery
- reference photos (Telegram file_id from the packet) via update_order_details
- customer name / phone when offered

Tools:
- update_order_details — merge any new facts into state (do not invent values)
- check_date_availability — required before accepting a date; do not invent availability
- search_knowledge_base — menu/policy lookup (may return empty; say you will check with the confectioner)
- submit_order — only when essentials are present (eventDate, weightKg, flavorName or designDescription)

Date resolution (critical):
- Resolve incomplete dates using Today above, never invent a past year.
- Month+day without year (e.g. "21 августа"): if that month/day already passed this year, use NEXT calendar year; otherwise use this year.
- Day-only ("24 число") without month: if the conversation already established a month/year, reuse it; otherwise ASK which month — do not invent a month.
- When the customer corrects a date, discard the previous guess and re-check with the tool.
- check_date_availability only enforces lead time. ok:false means "too soon", NOT "busy/booked". Never say a date is occupied/closed unless a tool explicitly says so.
- Quote tool reasons accurately in your reply.

Rules:
- Never invent dates, prices, or stock. Use tools.
- After tools run, send a short final reply the customer will see in Telegram.
- If the order was just submitted, confirm briefly and mention the confectioner will approve.`;
}

export type OrderAgentFlushContext = {
  tenantId: string;
  chatId: string;
  messages: BufferedMessage[];
  customer: OrderCustomer;
};

@Injectable()
export class OrderAgentService {
  private readonly logger = new Logger(OrderAgentService.name);
  /** Older/cheaper → newer flash-lite; next only on transient provider errors. */
  private readonly modelIds: string[];

  constructor(
    private readonly orderState: OrderStateService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config
      .get<string>('GOOGLE_GENERATIVE_AI_API_KEY')
      ?.trim();
    if (!apiKey) {
      this.logger.error(
        'GOOGLE_GENERATIVE_AI_API_KEY is missing; OrderAgentService cannot call Gemini',
      );
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is required');
    }

    this.modelIds = MODEL_ENV_KEYS.map((key) => {
      const id = this.config.get<string>(key)?.trim();
      return id ? id : '';
    }).filter(Boolean);

    if (this.modelIds.length === 0) {
      throw new Error(
        'At least GEMINI_MODEL_1 is required (optional GEMINI_MODEL_2, GEMINI_MODEL_3 for fallback)',
      );
    }

    this.logger.log(
      `Gemini model cascade (older→newer flash-lite): ${this.modelIds.join(' → ')}`,
    );
  }

  async processFlush(ctx: OrderAgentFlushContext): Promise<string> {
    const state = await this.orderState.getOrCreate(
      ctx.tenantId,
      ctx.chatId,
      ctx.customer,
    );

    const tools = createOrderAgentTools({
      tenantId: ctx.tenantId,
      chatId: ctx.chatId,
      customer: ctx.customer,
      orderState: this.orderState,
    });

    const todayUtc = dayjs.utc().format('YYYY-MM-DD');
    const earliestDate = utcDatePlusDays(MIN_LEAD_DAYS);
    const prompt = formatFlushPacket(ctx.messages, state, {
      todayUtc,
      earliestDate,
    });
    const instructions = buildSystemPrompt(todayUtc, earliestDate);

    this.logger.debug(
      `order agent flush chat=${ctx.chatId} todayUtc=${todayUtc} messages=${ctx.messages.length} status=${state.status}`,
    );

    let lastError: unknown;
    for (let i = 0; i < this.modelIds.length; i++) {
      const modelId = this.modelIds[i];
      const hasNext = i < this.modelIds.length - 1;

      try {
        const result = await generateText({
          model: google(modelId),
          instructions,
          prompt,
          tools,
          stopWhen: stepCountIs(MAX_TOOL_STEPS),
        });

        logAgentSteps(this.logger, ctx.chatId, result.steps);

        const reply = result.text?.trim() || EMPTY_REPLY_FALLBACK;
        this.logger.debug(
          `order agent reply chat=${ctx.chatId} model=${modelId} steps=${result.steps.length} chars=${reply.length}`,
        );
        return reply;
      } catch (error) {
        lastError = error;
        if (hasNext && isTransientModelError(error)) {
          this.logger.warn(
            `model=${modelId} failed (transient); falling back to ${this.modelIds[i + 1]}: ${formatError(error)}`,
          );
          continue;
        }
        throw error;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('All Gemini models failed');
  }
}

/** Capacity / rate-limit style failures that warrant trying the next model. */
export function isTransientModelError(error: unknown): boolean {
  if (RetryError.isInstance(error)) {
    return true;
  }
  if (APICallError.isInstance(error)) {
    if (error.isRetryable) return true;
    const status = error.statusCode;
    if (status === 429 || status === 503 || status === 500) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /high demand|unavailable|resource.?exhausted|overloaded|try again later/i.test(
    message,
  );
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export type FlushClock = {
  todayUtc: string;
  earliestDate: string;
};

export function formatFlushPacket(
  messages: BufferedMessage[],
  state: OrderState,
  clock: FlushClock,
): string {
  const lines = messages.map((message, index) => {
    const n = index + 1;
    if (message.type === 'text') {
      return `${n}. ${message.text}`;
    }
    const caption =
      message.caption != null && message.caption.length > 0
        ? ` caption=${JSON.stringify(message.caption)}`
        : '';
    return `${n}. [photo file_id=${message.fileId}${caption}]`;
  });

  return [
    `Today (UTC): ${clock.todayUtc}`,
    `Earliest bookable date: ${clock.earliestDate}`,
    '',
    'New customer messages (this flush):',
    ...lines,
    '',
    'Current order state (JSON):',
    JSON.stringify(state),
  ].join('\n');
}

/** Log tool calls/results so Telegram dialogs are debuggable from Nest stdout. */
function logAgentSteps(
  logger: Logger,
  chatId: string,
  steps: Array<{
    text: string;
    reasoningText?: string;
    toolCalls: Array<{ toolName: string; input: unknown }>;
    toolResults: Array<{ toolName: string; output: unknown }>;
  }>,
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.reasoningText?.trim()) {
      logger.debug(
        `agent step[${i}] chat=${chatId} reasoning=${JSON.stringify(step.reasoningText)}`,
      );
    }
    for (const call of step.toolCalls) {
      logger.log(
        `agent step[${i}] chat=${chatId} tool=${call.toolName} input=${JSON.stringify(call.input)}`,
      );
    }
    for (const tr of step.toolResults) {
      logger.log(
        `agent step[${i}] chat=${chatId} tool=${tr.toolName} result=${JSON.stringify(tr.output)}`,
      );
    }
    if (step.text?.trim()) {
      logger.debug(
        `agent step[${i}] chat=${chatId} text=${JSON.stringify(step.text)}`,
      );
    }
  }
}
