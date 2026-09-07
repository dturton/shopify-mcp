import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for getProductsByMetafield
const GetProductsByMetafieldInputSchema = z.object({
  namespace: z.string().min(1).describe("Metafield namespace, e.g. 'custom'"),
  key: z.string().min(1).describe("Metafield key, e.g. 'breakdown_parts'"),
  query: z
    .string()
    .optional()
    .describe(
      "Optional Shopify product search filter to narrow the scan, e.g. 'vendor:Goulds' or 'status:active'",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Stop scanning once at least this many matching products are collected. Omit to fetch all.",
    ),
  cursor: z
    .string()
    .optional()
    .describe("endCursor from a previous call, to continue scanning"),
});

type GetProductsByMetafieldInput = z.infer<
  typeof GetProductsByMetafieldInputSchema
>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const PAGE_SIZE = 250; // Shopify max per page
const RESOLVE_BATCH = 250; // Shopify max ids per nodes() call

const PRODUCTS_QUERY = gql`
  query ProductsByMetafield(
    $first: Int!
    $after: String
    $query: String
    $namespace: String!
    $key: String!
  ) {
    products(first: $first, after: $after, query: $query) {
      nodes {
        id
        title
        handle
        metafield(namespace: $namespace, key: $key) {
          id
          type
          jsonValue
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// Resolves referenced products/metaobjects one level deep (plus each metaobject field's own reference).
const RESOLVE_QUERY = gql`
  query ResolveReferences($ids: [ID!]!) {
    nodes(ids: $ids) {
      id
      ... on Product {
        title
        handle
      }
      ... on Metaobject {
        type
        handle
        displayName
        fields {
          key
          type
          value
          reference {
            ... on Product {
              id
              title
              handle
            }
            ... on Metaobject {
              id
              type
              handle
              displayName
            }
          }
        }
      }
    }
  }
`;

const isReference = (type: string) => type.endsWith("_reference");

const referenceGids = (metafield: { type: string; jsonValue: unknown }) => {
  if (!isReference(metafield.type)) return [];
  const v = metafield.jsonValue;
  return (Array.isArray(v) ? v : [v]).filter(
    (g): g is string => typeof g === "string",
  );
};

// Retry on Shopify THROTTLED errors so a full-catalog scan survives rate limiting.
async function request<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await shopifyClient.request(query, variables)) as T;
    } catch (error) {
      if (attempt >= 5 || !/throttled/i.test(String(error))) throw error;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
}

const getProductsByMetafield = {
  name: "get-products-by-metafield",
  description:
    "List every product that has a value for the given metafield (namespace + key), scanning the whole catalog. " +
    "Returns each product's id/title/handle and the metafield's id, type and jsonValue. " +
    "For reference types (e.g. list.metaobject_reference) the referenced products/metaobjects are resolved into `references`, in list order. " +
    "To write a value back use update-product with metafields [{ namespace, key, type, value }], where value is the string form (JSON.stringify for lists/objects); " +
    "to edit a referenced metaobject's fields use upsert-metaobject.",
  schema: GetProductsByMetafieldInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: GetProductsByMetafieldInput) => {
    try {
      const { namespace, key, query, limit, cursor } = input;

      const products: any[] = [];
      let after: string | null = cursor ?? null;
      let hasNextPage = false;
      let scanned = 0;

      do {
        const data: { products: any } = await request(PRODUCTS_QUERY, {
          first: PAGE_SIZE,
          after,
          query,
          namespace,
          key,
        });
        const page = data.products;
        scanned += page.nodes.length;
        products.push(...page.nodes.filter((p: any) => p.metafield));
        hasNextPage = page.pageInfo.hasNextPage;
        after = page.pageInfo.endCursor;
      } while (hasNextPage && (limit === undefined || products.length < limit));

      const gids = [
        ...new Set(products.flatMap((p) => referenceGids(p.metafield))),
      ];
      const resolved = new Map<string, any>();
      for (let i = 0; i < gids.length; i += RESOLVE_BATCH) {
        const data: { nodes: any[] } = await request(RESOLVE_QUERY, {
          ids: gids.slice(i, i + RESOLVE_BATCH),
        });
        for (const node of data.nodes) {
          if (!node) continue;
          node.fields = node.fields?.map(({ reference, ...f }: any) =>
            reference ? { ...f, reference } : f,
          );
          resolved.set(node.id, node);
        }
      }

      return {
        products: products.map((p) => ({
          id: p.id,
          title: p.title,
          handle: p.handle,
          metafield: {
            id: p.metafield.id,
            type: p.metafield.type,
            jsonValue: p.metafield.jsonValue,
            ...(isReference(p.metafield.type) && {
              references: referenceGids(p.metafield).map(
                (g) => resolved.get(g) ?? null,
              ),
            }),
          },
        })),
        count: products.length,
        scanned,
        hasNextPage,
        endCursor: hasNextPage ? after : null,
      };
    } catch (error) {
      console.error("Error fetching products by metafield:", error);
      throw new Error(
        `Failed to fetch products by metafield: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

export { getProductsByMetafield };
