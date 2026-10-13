import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../queue/redis.module';
import {
  type OrderCustomer,
  type OrderDetails,
  type OrderState,
  type OrderStatePatch,
  OrderStateSchema,
} from './order-state';

export const ORDER_STATE_TTL_SEC = 604_800; // 7 days

@Injectable()
export class OrderStateService {
  private readonly logger = new Logger(OrderStateService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  orderKey(tenantId: string, chatId: string): string {
    return `order:${tenantId}:${chatId}`;
  }

  createDefault(tenantId: string, customer: OrderCustomer): OrderState {
    return {
      orderId: randomUUID(),
      tenantId,
      customer: { ...customer },
      details: emptyDetails(),
      status: 'collecting',
    };
  }

  async get(tenantId: string, chatId: string): Promise<OrderState | null> {
    const raw = await this.redis.get(this.orderKey(tenantId, chatId));
    if (raw == null) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      const result = OrderStateSchema.safeParse(parsed);
      if (!result.success) {
        this.logger.warn(
          `Invalid OrderState at order:${tenantId}:${chatId}; treating as missing`,
        );
        return null;
      }
      return result.data;
    } catch {
      this.logger.warn(
        `Corrupt OrderState JSON at order:${tenantId}:${chatId}; treating as missing`,
      );
      return null;
    }
  }

  async save(
    tenantId: string,
    chatId: string,
    state: OrderState,
  ): Promise<void> {
    const key = this.orderKey(tenantId, chatId);
    const payload = JSON.stringify(OrderStateSchema.parse(state));
    await this.redis
      .multi()
      .set(key, payload)
      .expire(key, ORDER_STATE_TTL_SEC)
      .exec();
  }

  async getOrCreate(
    tenantId: string,
    chatId: string,
    customer: OrderCustomer,
  ): Promise<OrderState> {
    const existing = await this.get(tenantId, chatId);
    if (existing) {
      return existing;
    }
    const created = this.createDefault(tenantId, customer);
    await this.save(tenantId, chatId, created);
    return created;
  }

  /**
   * Deep-merges known customer/detail fields; appends `referenceImageUrls`.
   * Creates default state when none exists (requires `customer.telegramId` in patch or prior state).
   */
  async merge(
    tenantId: string,
    chatId: string,
    patch: OrderStatePatch,
    customerFallback?: OrderCustomer,
  ): Promise<OrderState> {
    let state = await this.get(tenantId, chatId);
    if (!state) {
      const telegramId =
        patch.customer?.telegramId ?? customerFallback?.telegramId;
      if (!telegramId) {
        throw new Error(
          `Cannot merge OrderState for chat=${chatId}: no existing state and no telegramId`,
        );
      }
      state = this.createDefault(tenantId, {
        telegramId,
        username: patch.customer?.username ?? customerFallback?.username,
        name: patch.customer?.name ?? customerFallback?.name,
        phone: patch.customer?.phone ?? customerFallback?.phone,
      });
    }

    const { referenceImageUrls, ...detailRest } = patch.details ?? {};

    state = {
      ...state,
      customer: patch.customer
        ? { ...state.customer, ...omitUndefined(patch.customer) }
        : state.customer,
      details: patch.details
        ? {
            ...state.details,
            ...omitUndefined(detailRest),
            referenceImageUrls: referenceImageUrls?.length
              ? appendUnique(
                  state.details.referenceImageUrls,
                  referenceImageUrls,
                )
              : state.details.referenceImageUrls,
          }
        : state.details,
      status: patch.status ?? state.status,
    };

    await this.save(tenantId, chatId, state);
    return state;
  }

  async reset(tenantId: string, chatId: string): Promise<void> {
    await this.redis.del(this.orderKey(tenantId, chatId));
  }
}

function emptyDetails(): OrderDetails {
  return {
    eventDate: null,
    weightKg: null,
    flavorName: null,
    designDescription: null,
    referenceImageUrls: [],
    deliveryType: null,
    deliveryAddress: null,
  };
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) {
      out[key] = obj[key];
    }
  }
  return out;
}

function appendUnique(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const next = [...existing];
  for (const url of incoming) {
    if (!seen.has(url)) {
      seen.add(url);
      next.push(url);
    }
  }
  return next;
}
