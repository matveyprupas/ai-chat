import { google } from '@ai-sdk/google';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateText, stepCountIs } from 'ai';
import type { BufferedMessage } from '../queue/message-buffer.types';
import { createOrderAgentTools } from './order-agent.tools';
import type { OrderCustomer, OrderState } from './order-state';
import { OrderStateService } from './order-state.service';

const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const MAX_TOOL_STEPS = 5;

const EMPTY_REPLY_FALLBACK =
  'Напишите ещё детали заказа, пожалуйста. / Please share a bit more order detail.';

const SYSTEM_PROMPT = `You are an order-intake assistant for a confectionery (cakes and desserts).

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

Rules:
- Never invent dates, prices, or stock. Use tools.
- After tools run, send a short final reply the customer will see in Telegram.
- If the order was just submitted, confirm briefly and mention the confectioner will approve.`;

export type OrderAgentFlushContext = {
  tenantId: string;
  chatId: string;
  messages: BufferedMessage[];
  customer: OrderCustomer;
};

@Injectable()
export class OrderAgentService {
  private readonly logger = new Logger(OrderAgentService.name);
  private readonly modelId: string;

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

    this.modelId =
      this.config.get<string>('GEMINI_MODEL')?.trim() || DEFAULT_MODEL;
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

    const prompt = formatFlushPacket(ctx.messages, state);

    const result = await generateText({
      model: google(this.modelId),
      instructions: SYSTEM_PROMPT,
      prompt,
      tools,
      stopWhen: stepCountIs(MAX_TOOL_STEPS),
    });

    const reply = result.text?.trim() || EMPTY_REPLY_FALLBACK;
    this.logger.debug(
      `order agent reply chat=${ctx.chatId} steps=${result.steps.length} chars=${reply.length}`,
    );
    return reply;
  }
}

export function formatFlushPacket(
  messages: BufferedMessage[],
  state: OrderState,
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
    'New customer messages (this flush):',
    ...lines,
    '',
    'Current order state (JSON):',
    JSON.stringify(state),
  ].join('\n');
}
