import { ebayApiBaseUrl, type EbayConfig } from "./config.js";
import { EbaySellerAuth } from "./seller-auth.js";

interface XmlNode { name: string; text: string; attributes: Record<string, string>; children: XmlNode[] }
const MAX_XML = 4_000_000;

function decodeXml(input: string): string {
  const decoded = input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const code = entity.startsWith("#x") ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    if (code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw new Error("EBAY_XML_INVALID");
    return String.fromCodePoint(code);
  });
  if (decoded.includes("&") && input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, "").includes("&")) throw new Error("EBAY_XML_INVALID");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded)) throw new Error("EBAY_XML_INVALID");
  return decoded;
}

function parseXml(xml: string): XmlNode {
  if (xml.length > MAX_XML || /<!DOCTYPE|<!ENTITY|<!\[CDATA\[/i.test(xml)) throw new Error("EBAY_XML_INVALID");
  const root: XmlNode = { name: "#document", text: "", attributes: {}, children: [] };
  const stack = [root];
  const tokens = /<\?xml\s+[^?]*\?>|<!--(?:.|\n|\r)*?-->|<\/?[A-Za-z][^>]*>|[^<]+/g;
  let position = 0;
  let nodes = 0;
  for (const match of xml.matchAll(tokens)) {
    if (match.index !== position) throw new Error("EBAY_XML_INVALID");
    const part = match[0];
    position += part.length;
    if (part.startsWith("<?xml") || part.startsWith("<!--")) continue;
    if (part.startsWith("</")) {
      const name = part.slice(2, -1).trim();
      if (stack.length <= 1 || stack.at(-1)?.name !== name) throw new Error("EBAY_XML_INVALID");
      stack.pop();
    } else if (part.startsWith("<")) {
      const parsed = /^<([A-Za-z][A-Za-z0-9_:.-]*)([^<>]*?)(\/?)>$/.exec(part);
      if (!parsed) throw new Error("EBAY_XML_INVALID");
      const attrs: Record<string, string> = {};
      const rest = parsed[2] ?? "";
      const attrRegex = /\s+([A-Za-z][A-Za-z0-9_:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let attrPosition = 0;
      for (const attribute of rest.matchAll(attrRegex)) {
        if (attribute.index !== attrPosition) throw new Error("EBAY_XML_INVALID");
        attrs[attribute[1]!] = decodeXml(attribute[2] ?? attribute[3] ?? "");
        attrPosition += attribute[0].length;
      }
      if (rest.slice(attrPosition).trim()) throw new Error("EBAY_XML_INVALID");
      const node: XmlNode = { name: parsed[1]!, text: "", attributes: attrs, children: [] };
      stack.at(-1)!.children.push(node);
      if (++nodes > 50_000) throw new Error("EBAY_XML_INVALID");
      if (!parsed[3]) {
        stack.push(node);
        if (stack.length > 65) throw new Error("EBAY_XML_INVALID");
      }
    } else {
      const content = decodeXml(part);
      if (stack.length === 1 && content.trim()) throw new Error("EBAY_XML_INVALID");
      stack.at(-1)!.text += content;
    }
  }
  if (position !== xml.length || stack.length !== 1 || root.children.length !== 1) throw new Error("EBAY_XML_INVALID");
  return root.children[0]!;
}

function child(node: XmlNode | undefined, name: string): XmlNode | undefined { return node?.children.find((value) => value.name === name); }
function at(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined { return path.reduce<XmlNode | undefined>(child, node); }
function value(node: XmlNode | undefined, ...path: string[]): string | null { return at(node, ...path)?.text.trim() || null; }
function count(raw: string | null): number | null {
  if (raw === null || !/^(0|[1-9][0-9]*)$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isSafeInteger(number) ? number : null;
}
function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !/(^|\.)ebay\.(com|co\.uk|de|fr|it|es|ca|com\.au)$/.test(url.hostname) || !url.pathname.startsWith("/itm/")) return null;
    url.search = "";
    url.hash = "";
    return url.href;
  } catch { return null; }
}
function time(raw: string | null): string | null { return raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null; }

export function normalizeActiveListings(xml: string, limit: number, page: number, asOf = new Date().toISOString()) {
  const response = parseXml(xml);
  if (response.name !== "GetMyeBaySellingResponse" || !["Success", "Warning"].includes(value(response, "Ack") ?? "")) throw new Error("EBAY_LISTINGS_UNAVAILABLE");
  const active = child(response, "ActiveList");
  const items = child(active, "ItemArray")?.children.filter((node) => node.name === "Item") ?? [];
  const listings = items.map((item) => {
    const priceNode = at(item, "SellingStatus", "CurrentPrice");
    const priceText = priceNode?.text.trim() ?? "";
    const currency = priceNode?.attributes.currencyID ?? "";
    const id = value(item, "ItemID");
    if (!id || !/^[0-9]{8,20}$/.test(id)) throw new Error("EBAY_LISTINGS_UNAVAILABLE");
    return {
      itemId: id,
      title: value(item, "Title"),
      listingType: value(item, "ListingType"),
      currentPrice: /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(priceText) && /^[A-Z]{3}$/.test(currency) ? { amount: priceText, currency } : null,
      quantityAvailable: count(value(item, "QuantityAvailable")),
      quantitySold: count(value(item, "SellingStatus", "QuantitySold")),
      startTime: time(value(item, "ListingDetails", "StartTime")),
      endTime: time(value(item, "ListingDetails", "EndTime")),
      category: value(item, "PrimaryCategory", "CategoryID") ? {
        id: value(item, "PrimaryCategory", "CategoryID"), name: value(item, "PrimaryCategory", "CategoryName"),
      } : null,
      watchCount: count(value(item, "WatchCount")),
      viewCount: null,
      url: safeUrl(value(item, "ListingDetails", "ViewItemURL")),
    };
  });
  const totalPages = count(value(active, "PaginationResult", "TotalNumberOfPages"));
  const totalEntries = count(value(active, "PaginationResult", "TotalNumberOfEntries"));
  return { evidenceType: "ACTIVE_LISTING", asOf, listings,
    pagination: { limit, page, totalPages, totalEntries, nextCursor: totalPages !== null && page < Math.min(totalPages, 125) ? String(page + 1) : null,
      truncatedAtEbayLimit: totalEntries === 25_000 && totalPages === 125 } };
}

export class ActiveListingsService {
  constructor(private readonly config: EbayConfig, private readonly auth: EbaySellerAuth) {}

  async get(limit = 25, cursor?: string) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("EBAY_PAGINATION_INVALID");
    const page = cursor === undefined ? 1 : /^(?:[1-9]|[1-9][0-9]|1[01][0-9]|12[0-5])$/.test(cursor) ? Number(cursor) : NaN;
    if (!Number.isInteger(page) || page < 1 || page > 125) throw new Error("EBAY_PAGINATION_INVALID");
    const accessToken = await this.auth.accessToken();
    const request = `<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><ActiveList><Include>true</Include><Pagination><EntriesPerPage>${limit}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><IncludeWatchCount>true</IncludeWatchCount><HideVariations>true</HideVariations></GetMyeBaySellingRequest>`;
    const response = await fetch(`${ebayApiBaseUrl(this.config.environment)}/ws/api.dll`, {
      method: "POST", headers: { "Content-Type": "text/xml", "X-EBAY-API-IAF-TOKEN": accessToken,
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling", "X-EBAY-API-SITEID": "0", "X-EBAY-API-COMPATIBILITY-LEVEL": "1477" },
      body: request,
    });
    if (!response.ok || Number(response.headers.get("Content-Length") ?? "0") > MAX_XML) throw new Error("EBAY_LISTINGS_UNAVAILABLE");
    const normalized = normalizeActiveListings(await response.text(), limit, page);
    return { ...normalized, environment: this.config.environment };
  }
}
