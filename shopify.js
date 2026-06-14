'use strict';

const API_VERSION = '2025-01';

function getClient() {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !token) {
    throw new Error('SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN env vars are required');
  }
  return { domain, token };
}

async function shopifyGraphQL(query, variables = {}) {
  const { domain, token } = getClient();
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${res.statusText}`);
  }

  const body = await res.json();
  if (body.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

const PRODUCTS_QUERY = `
  query GetCollectionProducts($collectionId: ID!, $first: Int!, $after: String) {
    collection(id: $collectionId) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            descriptionHtml
            vendor
            productType
            images(first: 5) {
              edges { node { url } }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  barcode
                  price
                  compareAtPrice
                  inventoryQuantity
                  availableForSale
                  selectedOptions { name value }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function fetchAllProducts(collectionId) {
  const products = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 0;

  while (hasNextPage) {
    page++;
    console.log(`[Shopify] Fetching page ${page}...`);

    const data = await shopifyGraphQL(PRODUCTS_QUERY, {
      collectionId,
      first: 50,
      after: cursor,
    });

    const { edges, pageInfo } = data.collection.products;
    products.push(...edges.map((e) => e.node));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;

    if (hasNextPage) await sleep(250);
  }

  console.log(`[Shopify] Fetched ${products.length} products total`);
  return products;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { fetchAllProducts };
