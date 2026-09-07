import type { GraphQLClient } from "graphql-request";
import { gql } from "graphql-request";
import { z } from "zod";

const SearchProductBySkuInputSchema = z.object({
  sku: z.string().min(1),
  limit: z.number().default(10)
});

type SearchProductBySkuInput = z.infer<typeof SearchProductBySkuInputSchema>;

let shopifyClient: GraphQLClient;

const searchProductBySku = {
  name: "search-product-by-sku",
  description: "Search for products by variant SKU",
  schema: SearchProductBySkuInputSchema,

  initialize(client: GraphQLClient) {
    shopifyClient = client;
  },

  execute: async (input: SearchProductBySkuInput) => {
    try {
      const { sku, limit } = input;

      const query = gql`
        query SearchProductBySku($first: Int!, $query: String!) {
          products(first: $first, query: $query) {
            edges {
              node {
                id
                title
                description
                handle
                status
                createdAt
                updatedAt
                totalInventory
                priceRangeV2 {
                  minVariantPrice {
                    amount
                    currencyCode
                  }
                  maxVariantPrice {
                    amount
                    currencyCode
                  }
                }
                images(first: 1) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                variants(first: 100) {
                  edges {
                    node {
                      id
                      title
                      price
                      inventoryQuantity
                      sku
                    }
                  }
                }
              }
            }
          }
        }
      `;

      const variables = {
        first: limit,
        query: `sku:${sku}`
      };

      const data = (await shopifyClient.request(query, variables)) as {
        products: any;
      };

      const products = data.products.edges.map((edge: any) => {
        const product = edge.node;

        const variants = product.variants.edges.map((variantEdge: any) => ({
          id: variantEdge.node.id,
          title: variantEdge.node.title,
          price: variantEdge.node.price,
          inventoryQuantity: variantEdge.node.inventoryQuantity,
          sku: variantEdge.node.sku
        }));

        const imageUrl =
          product.images.edges.length > 0
            ? product.images.edges[0].node.url
            : null;

        return {
          id: product.id,
          title: product.title,
          description: product.description,
          handle: product.handle,
          status: product.status,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          totalInventory: product.totalInventory,
          priceRange: {
            minPrice: {
              amount: product.priceRangeV2.minVariantPrice.amount,
              currencyCode: product.priceRangeV2.minVariantPrice.currencyCode
            },
            maxPrice: {
              amount: product.priceRangeV2.maxVariantPrice.amount,
              currencyCode: product.priceRangeV2.maxVariantPrice.currencyCode
            }
          },
          imageUrl,
          variants
        };
      });

      return { products };
    } catch (error) {
      console.error("Error searching products by SKU:", error);
      throw new Error(
        `Failed to search products by SKU: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
};

export { searchProductBySku };
