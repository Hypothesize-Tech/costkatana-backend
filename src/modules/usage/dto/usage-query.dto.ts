import { z } from 'zod';

// Pagination schema
export const PaginationDto = z.object({
  page: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .optional(),
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive().max(100))
    .optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

// Usage query DTO - mirrors query parameters from Express getUsage controller
export const UsageQueryDto = PaginationDto.extend({
  // Date range filters
  startDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    })
    .optional(),
  endDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    })
    .optional(),

  // Filtering parameters
  projectId: z.string().optional(),
  service: z.string().optional(),
  model: z.string().optional(),
  tags: z.string().optional(), // Will be split by comma

  // Cost filters
  minCost: z
    .string()
    .transform(Number)
    .pipe(z.number().nonnegative())
    .optional(),
  maxCost: z
    .string()
    .transform(Number)
    .pipe(z.number().nonnegative())
    .optional(),

  // Property filters (dynamic)
  // property.* - handled dynamically in controller

  // Search query
  q: z.string().optional(), // Search query

  // Analytics specific
  period: z.enum(['daily', 'weekly', 'monthly']).optional(),
  groupBy: z.enum(['service', 'model', 'date', 'hour']).optional(),

  // CLI analytics specific
  days: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .optional(),
  project: z.string().optional(),
  user: z.string().optional(),

  // Optimization specific
  startDateOpt: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    })
    .optional(),
  endDateOpt: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    })
    .optional(),
  limit: z
    .string()
    .transform(Number)
    .pipe(z.number().int().positive())
    .optional(),
}).refine(
  (data) => {
    // Validate date range if both dates are provided
    if (data.startDate && data.endDate) {
      return new Date(data.startDate) <= new Date(data.endDate);
    }
    return true;
  },
  {
    message: 'Start date must be before or equal to end date',
    path: ['startDate'],
  },
);

export type UsageQueryDtoType = z.infer<typeof UsageQueryDto>;
export type PaginationDtoType = z.infer<typeof PaginationDto>;
