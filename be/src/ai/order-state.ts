import { z } from 'zod';

export const ORDER_STATUS = [
  'collecting',
  'pending_approval',
  'approved',
  'rejected',
] as const;

export const DeliveryTypeSchema = z.enum(['pickup', 'delivery']);

export const OrderCustomerSchema = z.object({
  telegramId: z.string().min(1),
  username: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
});

export const OrderDetailsSchema = z.object({
  eventDate: z.string().nullable(), // YYYY-MM-DD
  weightKg: z.number().nullable(),
  flavorName: z.string().nullable(),
  designDescription: z.string().nullable(),
  referenceImageUrls: z.array(z.string()), // Telegram file_id
  deliveryType: DeliveryTypeSchema.nullable(),
  deliveryAddress: z.string().nullable(),
});

export const OrderStateSchema = z.object({
  orderId: z.string().uuid(),
  tenantId: z.string().min(1),
  customer: OrderCustomerSchema,
  details: OrderDetailsSchema,
  status: z.enum(ORDER_STATUS),
});

export type OrderCustomer = z.infer<typeof OrderCustomerSchema>;
export type OrderDetails = z.infer<typeof OrderDetailsSchema>;
export type OrderState = z.infer<typeof OrderStateSchema>;
export type OrderStatus = OrderState['status'];
export type DeliveryType = z.infer<typeof DeliveryTypeSchema>;

/** Partial details patch; `referenceImageUrls` are appended on merge. */
export type OrderDetailsPatch = Partial<OrderDetails>;

export type OrderStatePatch = {
  customer?: Partial<OrderCustomer>;
  details?: OrderDetailsPatch;
  status?: OrderStatus;
};
