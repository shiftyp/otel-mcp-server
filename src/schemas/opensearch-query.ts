/**
 * Zod schemas for OpenSearch query validation using OpenSearch types
 */

import { z } from 'zod';

// Sort schema that matches OpenSearch's Sort type
export const SortSchema = z.union([
  z.string(),
  z.record(z.union([
    z.enum(['asc', 'desc']),
    z.object({
      order: z.enum(['asc', 'desc']).optional(),
      missing: z.enum(['_first', '_last']).optional(),
      mode: z.enum(['min', 'max', 'sum', 'avg', 'median']).optional()
    })
  ])),
  z.array(z.union([
    z.string(),
    z.record(z.union([
      z.enum(['asc', 'desc']),
      z.object({
        order: z.enum(['asc', 'desc']).optional(),
        missing: z.enum(['_first', '_last']).optional(),
        mode: z.enum(['min', 'max', 'sum', 'avg', 'median']).optional()
      })
    ]))
  ]))
]);

// Query DSL schema - simplified version that validates common queries
const MatchQuerySchema = z.object({
  match: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({
      query: z.union([z.string(), z.number(), z.boolean()]),
      operator: z.enum(['and', 'or']).optional(),
      analyzer: z.string().optional(),
      boost: z.number().optional(),
      fuzziness: z.union([z.string(), z.number()]).optional()
    })
  ]))
});

const TermQuerySchema = z.object({
  term: z.record(z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.object({
      value: z.union([z.string(), z.number(), z.boolean()]),
      boost: z.number().optional()
    })
  ]))
});

const TermsQuerySchema = z.object({
  terms: z.record(z.union([
    z.array(z.union([z.string(), z.number(), z.boolean()])),
    z.object({
      value: z.array(z.union([z.string(), z.number(), z.boolean()])),
      boost: z.number().optional()
    })
  ]))
});

const RangeQuerySchema = z.object({
  range: z.record(z.object({
    gte: z.union([z.string(), z.number()]).optional(),
    gt: z.union([z.string(), z.number()]).optional(),
    lte: z.union([z.string(), z.number()]).optional(),
    lt: z.union([z.string(), z.number()]).optional(),
    format: z.string().optional(),
    boost: z.number().optional()
  }))
});

const ExistsQuerySchema = z.object({
  exists: z.object({
    field: z.string(),
    boost: z.number().optional()
  })
});

const MatchAllQuerySchema = z.object({
  match_all: z.object({
    boost: z.number().optional()
  }).optional()
});

// Forward declare for circular reference
let BoolQuerySchema: z.ZodType<any>;

// Recursive bool query schema
const QueryDSLSchema: z.ZodType<any> = z.lazy(() =>
  z.union([
    MatchQuerySchema,
    TermQuerySchema,
    TermsQuerySchema,
    RangeQuerySchema,
    ExistsQuerySchema,
    MatchAllQuerySchema,
    BoolQuerySchema,
    z.object({
      match_phrase: z.record(z.union([z.string(), z.object({
        query: z.string(),
        analyzer: z.string().optional()
      })]))
    }),
    z.object({
      wildcard: z.record(z.union([z.string(), z.object({
        value: z.string(),
        boost: z.number().optional()
      })]))
    }),
    z.object({
      query_string: z.object({
        query: z.string(),
        default_field: z.string().optional(),
        fields: z.array(z.string()).optional()
      })
    }),
    z.record(z.unknown()) // Fallback for other query types
  ])
);

BoolQuerySchema = z.object({
  bool: z.object({
    must: z.union([QueryDSLSchema, z.array(QueryDSLSchema)]).optional(),
    filter: z.union([QueryDSLSchema, z.array(QueryDSLSchema)]).optional(),
    should: z.union([QueryDSLSchema, z.array(QueryDSLSchema)]).optional(),
    must_not: z.union([QueryDSLSchema, z.array(QueryDSLSchema)]).optional(),
    minimum_should_match: z.union([z.number(), z.string()]).optional(),
    boost: z.number().optional()
  })
});

// Aggregation schema - simplified for common aggregations
export const AggregationSchema = z.record(z.unknown());

// Main query schema export
export const OpenSearchQuerySchema = QueryDSLSchema;