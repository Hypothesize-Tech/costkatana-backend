import { z } from 'zod';

// Schema for submitting confirmation response
export const submitConfirmationSchema = z.object({
  confirmationId: z.string().uuid('Invalid confirmation ID format'),
  confirmed: z.boolean(),
});

export type SubmitConfirmationDto = z.infer<typeof submitConfirmationSchema>;

// Schema for handling client messages
export const handleMessageSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
  message: z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string().optional(),
    params: z.any().optional(),
    result: z.any().optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: z.any().optional(),
      })
      .optional(),
  }),
});

export type HandleMessageDto = z.infer<typeof handleMessageSchema>;
