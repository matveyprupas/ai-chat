export const DEBOUNCE_MS = 3000;
export const BUFFER_TTL_SEC = 60;
export const MESSAGE_BUFFER_QUEUE = 'message-buffer';

export type BufferedMessage =
  | { type: 'text'; text: string; messageId: number; at: number }
  | {
      type: 'photo';
      fileId: string;
      caption: string | null;
      messageId: number;
      at: number;
    };

/** Telegram customer fields carried on the flush job (not in the Redis list). */
export type BufferJobCustomer = {
  telegramId: string;
  username?: string;
  firstName?: string;
};

export type BufferJobData = {
  tenantId: string;
  chatId: string;
  customer: BufferJobCustomer;
};
