import { tool } from 'ai';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { z } from 'zod';
import { DeliveryTypeSchema, type OrderCustomer } from './order-state';
import type { OrderStateService } from './order-state.service';

dayjs.extend(utc);

export const MIN_LEAD_DAYS = 2;

export type OrderAgentToolContext = {
  tenantId: string;
  chatId: string;
  customer: OrderCustomer;
  orderState: OrderStateService;
};

/**
 * Stub tools for order intake. Date rule is hardcoded UTC +2 calendar days;
 * KB search and submit are stubs (no RAG / Postgres).
 */
export function createOrderAgentTools(ctx: OrderAgentToolContext) {
  return {
    update_order_details: tool({
      description: `Merge partial order details into the current order state.
Pass only fields you learned; omit unknowns.
For photos, pass Telegram file_id values in referenceImageUrls.`,
      inputSchema: z.object({
        eventDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable()
          .optional()
          .describe('Event date YYYY-MM-DD'),
        weightKg: z.number().positive().nullable().optional(),
        flavorName: z.string().nullable().optional(),
        designDescription: z.string().nullable().optional(),
        referenceImageUrls: z
          .array(z.string().min(1))
          .optional()
          .describe('Telegram photo file_id values to append'),
        deliveryType: DeliveryTypeSchema.nullable().optional(),
        deliveryAddress: z.string().nullable().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
      }),
      execute: async ({
        customerName,
        customerPhone,
        referenceImageUrls,
        ...detailFields
      }) => {
        const state = await ctx.orderState.merge(
          ctx.tenantId,
          ctx.chatId,
          {
            customer: {
              name: customerName,
              phone: customerPhone,
            },
            details: {
              ...detailFields,
              referenceImageUrls,
            },
          },
          ctx.customer,
        );

        return {
          ok: true,
          status: state.status,
          details: state.details,
          customer: state.customer,
        };
      },
    }),

    search_knowledge_base: tool({
      description:
        'Search the confectionery knowledge base (menu, flavors, policies). Stub — returns no results yet.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Search query'),
      }),
      execute: () => ({ results: [] }),
    }),

    check_date_availability: tool({
      description: `Check lead-time only (not a real calendar/booking system).
Rejects dates before today UTC + ${MIN_LEAD_DAYS} days. ok:false means TOO SOON — never "busy" or "fully booked".`,
      inputSchema: z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe('Candidate event date YYYY-MM-DD (resolved year included)'),
      }),
      execute: ({ date }) => {
        const minDate = utcDatePlusDays(MIN_LEAD_DAYS);
        if (date < minDate) {
          return {
            ok: false,
            code: 'too_soon' as const,
            reason: `Date ${date} is too soon (lead-time rule only — not booked/occupied). Earliest date is ${minDate} (UTC, +${MIN_LEAD_DAYS} calendar days).`,
          };
        }
        return {
          ok: true,
          code: 'ok' as const,
          reason: `Date ${date} meets the +${MIN_LEAD_DAYS} day lead-time rule (not a real capacity check).`,
        };
      },
    }),

    submit_order: tool({
      description: `Submit the order for confectioner approval when essentials are collected.
Requires eventDate, weightKg, and flavorName or designDescription.`,
      inputSchema: z.object({}),
      execute: async () => {
        const state = await ctx.orderState.get(ctx.tenantId, ctx.chatId);
        if (!state) {
          return {
            ok: false,
            reason: 'No order state found. Collect details first.',
          };
        }

        const { eventDate, weightKg, flavorName, designDescription } =
          state.details;
        const missing: string[] = [];
        if (!eventDate) missing.push('eventDate');
        if (weightKg == null) missing.push('weightKg');
        if (!flavorName && !designDescription) {
          missing.push('flavorName or designDescription');
        }

        if (missing.length > 0) {
          return {
            ok: false,
            reason: `Cannot submit yet; missing: ${missing.join(', ')}`,
          };
        }

        const updated = await ctx.orderState.merge(
          ctx.tenantId,
          ctx.chatId,
          { status: 'pending_approval' },
          ctx.customer,
        );

        return {
          ok: true,
          status: updated.status,
          message:
            'Order submitted for confectioner approval (stub — not persisted to Postgres).',
          orderId: updated.orderId,
        };
      },
    }),
  };
}

export type OrderAgentTools = ReturnType<typeof createOrderAgentTools>;

/** YYYY-MM-DD for UTC calendar today + `days`. */
export function utcDatePlusDays(days: number): string {
  return dayjs.utc().add(days, 'day').format('YYYY-MM-DD');
}
