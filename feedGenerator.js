'use strict';

/**
 * Strip HTML tags and decode basic HTML entities.
 */
function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Escape characters that are unsafe outside CDATA in XML.
 */
function escapeXml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildVariantXml(product, variant, options) {
  const { vatRate, currency, language, defaultCategory } = options;

  const variants = product.variants.edges.map((e) => e.node);
  const hasMultipleVariants = variants.length > 1;
  const images = product.images.edges.map((e) => e.node.url);

  // IDs
  const productId = product.handle;
  const skuId = variant.sku
    ? variant.sku
    : hasMultipleVariants
    ? `${product.handle}-${variant.id.split('/').pop()}`
    : product.handle;

  // GTIN / EAN
  const ean = variant.barcode || 'EXCEP';

  // Stock
  const qty = variant.inventoryQuantity != null ? Math.max(0, variant.inventoryQuantity) : 0;
  const stockStatus = variant.availableForSale && qty > 0 ? 'INSTOCK' : 'OUTOFSTOCK';

  // Price
  const price = parseFloat(variant.price);
  const compareAt = variant.compareAtPrice ? parseFloat(variant.compareAtPrice) : null;
  const normalPrice = compareAt && compareAt > price ? compareAt : price;
  const discountPrice = compareAt && compareAt > price ? price : null;

  // Variant attributes
  let attrSize = '';
  let attrColor = '';
  if (hasMultipleVariants) {
    for (const opt of variant.selectedOptions) {
      if (/size/i.test(opt.name)) attrSize = opt.value;
      else if (/colou?r/i.test(opt.name)) attrColor = opt.value;
    }
  }

  const description = stripHtml(product.descriptionHtml) || product.title;

  let xml = `  <Product>
    <ProductId>${escapeXml(productId)}</ProductId>
    <SkuId>${escapeXml(skuId)}</SkuId>
    <EAN>${escapeXml(ean)}</EAN>
    <Brand>${escapeXml(product.vendor || 'Unknown')}</Brand>
    <Manufacturer>${escapeXml(product.vendor || 'Unknown')}</Manufacturer>
    <Category>${escapeXml(defaultCategory)}</Category>`;

  images.slice(0, 5).forEach((url, i) => {
    xml += `\n    <Imageurl${i + 1}>${escapeXml(url)}</Imageurl${i + 1}>`;
  });

  xml += `
    <StockStatus>${stockStatus}</StockStatus>
    <StockQuantity>${qty}</StockQuantity>
    <Description>
      <Language>${escapeXml(language)}</Language>
      <Title><![CDATA[${product.title}]]></Title>
      <Description><![CDATA[${description}]]></Description>`;

  if (attrSize) xml += `\n      <AttributeSize><![CDATA[${attrSize}]]></AttributeSize>`;
  if (attrColor) xml += `\n      <AttributeColor><![CDATA[${attrColor}]]></AttributeColor>`;

  xml += `
    </Description>
    <Price>`;

  if (currency) xml += `\n      <Currency>${escapeXml(currency)}</Currency>`;

  xml += `
      <NormalPriceWithVAT>${normalPrice.toFixed(2)}</NormalPriceWithVAT>`;

  if (discountPrice !== null) {
    xml += `\n      <DiscountPriceWithVAT>${discountPrice.toFixed(2)}</DiscountPriceWithVAT>`;
  }

  xml += `
      <VATRate>${vatRate}</VATRate>
    </Price>
  </Product>`;

  return xml;
}

function generateXml(products, options = {}) {
  const opts = {
    vatRate: options.vatRate ?? 21,
    currency: options.currency || 'EUR',
    language: options.language || 'en',
    defaultCategory: options.defaultCategory || 'Other',
  };

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<Products>'];

  for (const product of products) {
    const variants = product.variants.edges.map((e) => e.node);
    for (const variant of variants) {
      lines.push(buildVariantXml(product, variant, opts));
    }
  }

  lines.push('</Products>');
  return lines.join('\n');
}

module.exports = { generateXml };
