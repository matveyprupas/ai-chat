export const DEBOUNCE_MS = 3000;
export const BUFFER_TTL_SEC = 60;

export type BufferedMessage =
  | { type: 'text'; text: string; messageId: number; at: number }
  | {
      type: 'photo';
      fileId: string;
      caption: string | null;
      messageId: number;
      at: number;
    };

export type BufferJobData = { tenantId: string; chatId: string };
