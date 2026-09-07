import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

// Input schema for upsertMetaobject
const UpsertMetaobjectInputSchema = z.object({
  type: z
    .string()
    .min(1)
    .describe("Metaobject definition type, e.g. 'breakdown_part'"),
  handle: z
    .string()
    .min(1)
    .describe(
      "Metaobject handle. An existing handle is updated in place; a new handle creates a new metaobject.",
    ),
  fields: z
    .array(
      z.object({
        key: z.string().min(1),
        value: z
          .string()
          .describe(
            "Value as a string. References are GIDs, e.g. 'gid://shopify/Product/123'; lists/objects are JSON-encoded.",
          ),
      }),
    )
    .min(1)
    .describe("Fields to set. Fields not listed are left unchanged."),
});

type UpsertMetaobjectInput = z.infer<typeof UpsertMetaobjectInputSchema>;

// Will be initialized in index.ts
let shopifyClient: GraphQLClient;

const upsertMetaobject = {
  name: "upsert-metaobject",
  description:
    "Create or update a metaobject by type + handle (e.g. a breakdown part). Only the given fields change.",
  schema: UpsertMetaobjectInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: UpsertMetaobjectInput) => {
    try {
      const { type, handle, fields } = input;

      const query = gql`
        mutation metaobjectUpsert(
          $handle: MetaobjectHandleInput!
          $metaobject: MetaobjectUpsertInput!
        ) {
          metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
            metaobject {
              id
              type
              handle
              displayName
              fields {
                key
                type
                value
              }
            }
            userErrors {
              field
              message
              code
            }
          }
        }
      `;

      const data = (await shopifyClient.request(query, {
        handle: { type, handle },
        metaobject: { fields },
      })) as {
        metaobjectUpsert: {
          metaobject: any;
          userErrors: Array<{ field: string[]; message: string; code: string }>;
        };
      };

      if (data.metaobjectUpsert.userErrors.length > 0) {
        throw new Error(
          data.metaobjectUpsert.userErrors
            .map((e) => `${e.field?.join(".")}: ${e.message}`)
            .join(", "),
        );
      }

      return { metaobject: data.metaobjectUpsert.metaobject };
    } catch (error) {
      console.error("Error upserting metaobject:", error);
      throw new Error(
        `Failed to upsert metaobject: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};

export { upsertMetaobject };
