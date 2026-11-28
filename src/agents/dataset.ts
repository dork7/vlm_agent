import { access } from "node:fs/promises";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, extname, join, resolve, sep } from "node:path";
import { ObjectId } from "mongodb";
import { parseCsv } from "./csv.ts";
import { normalizeUnitType } from "./unit-type.ts";
import {
  FIELD_ROLES,
  type AgentsStore,
  type DatasetDoc,
  type DatasetRowDoc,
  type FieldMapping,
  type FieldRole,
  type Listing,
  type MissingImage,
} from "./types.ts";

export class DatasetError extends Error {}

/** Header names that usually hold each role, used to guess a mapping. */
const GUESSES: Record<FieldRole, RegExp[]> = {
  location: [/^location$/i, /area|community|neighbou?rhood|address|city/i],
  unit_type: [/^unit[_ ]?type$/i, /unit|bedroom|beds?$|type/i],
  price: [/^price$/i, /rent|price|cost|amount/i],
  images: [/^images?$/i, /image|photo|picture/i],
  payment: [/^payment/i, /payment|terms|cheque|installment/i],
};

export function guessMapping(fields: string[]): Partial<FieldMapping> {
  const mapping: Partial<FieldMapping> = {};
  const taken = new Set<string>();
  for (const role of FIELD_ROLES) {
    for (const pattern of GUESSES[role]) {
      const hit = fields.find((f) => pattern.test(f) && !taken.has(f));
      if (hit) { mapping[role] = hit; taken.add(hit); break; }
    }
  }
  return mapping;
}

/** The mapping if it names a field of the Dataset for every role; otherwise the roles that are missing or unknown. */
export function validateMapping(fields: string[], mapping: Partial<FieldMapping>): { ok: true; mapping: FieldMapping } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  for (const role of FIELD_ROLES) {
    const field = mapping[role];
    if (!field) problems.push(`Choose the field that holds ${role.replace("_", " ")}.`);
    else if (!fields.includes(field)) problems.push(`The field "${field}" for ${role.replace("_", " ")} is not in the Dataset.`);
  }
  return problems.length ? { ok: false, problems } : { ok: true, mapping: mapping as FieldMapping };
}

/** Reads CSV or JSON text into records of strings; throws a DatasetError that says what is wrong with it. */
export function parseDatasetText(text: string, filename: string): { fields: string[]; records: Record<string, string>[] } {
  const ext = extname(filename).toLowerCase();
  if (ext === ".json") {
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (error) { throw new DatasetError(`The JSON file could not be read: ${(error as Error).message}`); }
    const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" ? Object.values(parsed).find(Array.isArray) : undefined);
    if (!Array.isArray(list) || list.some((x) => !x || typeof x !== "object" || Array.isArray(x))) {
      throw new DatasetError("The JSON file must be a list of objects, one per Listing.");
    }
    const fields: string[] = [];
    const records = list.map((item) => {
      const record: Record<string, string> = {};
      for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
        if (!fields.includes(key)) fields.push(key);
        record[key] = Array.isArray(value) ? value.map(String).join("|") : value === null || value === undefined ? "" : String(value);
      }
      return record;
    });
    if (records.length === 0) throw new DatasetError("The file has no rows.");
    return { fields, records };
  }
  if (ext !== ".csv") throw new DatasetError("Datasets must be .csv or .json files.");
  let rows: string[][];
  try { rows = parseCsv(text); } catch (error) { throw new DatasetError((error as Error).message); }
  if (rows.length < 2) throw new DatasetError("The CSV needs a header row and at least one row.");
  const fields = rows[0]!.map((f) => f.trim());
  if (fields.some((f) => f === "") || new Set(fields).size !== fields.length) throw new DatasetError("The CSV header has an empty or repeated field name.");
  const records = rows.slice(1).map((cells, i) => {
    if (cells.length !== fields.length) throw new DatasetError(`CSV row ${i + 2} has ${cells.length} cells but the header has ${fields.length}.`);
    return Object.fromEntries(fields.map((f, j) => [f, cells[j]!.trim()]));
  });
  return { fields, records };
}

/** Parses a price like "AED 5,500", "5500/month" or "$1.2k"; null when there is no number. */
export function parsePrice(text: string): number | null {
  const match = /(\d[\d,]*(?:\.\d+)?)\s*(k)?/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]!.replace(/,/g, ""));
  return Number.isFinite(value) ? (match[2] ? value * 1000 : value) : null;
}

export function splitImages(text: string): string[] {
  return text.split(/[|;]|,(?=\s*\S+\.(?:jpe?g|png|webp|gif)\b)/i).map((s) => s.trim()).filter(Boolean);
}

/** Whether `relative` is inside `root` once resolved (blocks "../" tricks). */
export function insideFolder(root: string, relative: string): string | null {
  const absolute = resolve(root, relative);
  return absolute === resolve(root) || absolute.startsWith(resolve(root) + sep) ? absolute : null;
}

export type ImportInput = {
  store: AgentsStore;
  datasetDir: string;
  /** A file already inside the dataset folder. */
  sourceFile: string;
  name?: string;
  mapping?: Partial<FieldMapping>;
  /** Re-import into this existing Dataset, replacing its rows. */
  datasetId?: ObjectId;
  now?: () => Date;
};

/**
 * Imports (or re-imports) a Dataset file. Rows are only stored once a valid mapping exists; without one the Dataset keeps
 * its field list so the operator can map it. Re-import replaces every row, so later searches see the new data at once.
 */
export async function importDataset(input: ImportInput): Promise<DatasetDoc & { _id: ObjectId }> {
  const { store, datasetDir, sourceFile, now = () => new Date() } = input;
  const path = insideFolder(datasetDir, sourceFile);
  if (!path) throw new DatasetError("That file is outside the dataset folder.");
  let text: string;
  try { text = await readFile(path, "utf8"); } catch { throw new DatasetError(`Could not read ${sourceFile} in the dataset folder.`); }
  const { fields, records } = parseDatasetText(text, sourceFile);

  const existing = input.datasetId ? await store.datasets.findOne({ _id: input.datasetId }) : null;
  if (input.datasetId && !existing) throw new DatasetError("That Dataset does not exist.");
  const requested = input.mapping ?? existing?.mapping ?? guessMapping(fields);
  const checked = validateMapping(fields, requested);

  const _id = existing?._id ?? new ObjectId();
  const missingImages: MissingImage[] = [];
  const rows: DatasetRowDoc[] = [];
  if (checked.ok) {
    const m = checked.mapping;
    for (const [i, data] of records.entries()) {
      const images = splitImages(data[m.images] ?? "");
      for (const image of images) {
        const imagePath = insideFolder(datasetDir, image.startsWith("images/") ? image : join("images", image));
        const found = imagePath ? await access(imagePath).then(() => true, () => false) : false;
        if (!found) missingImages.push({ row: i + 1, path: image });
      }
      rows.push({
        datasetId: _id, index: i + 1, data,
        location: data[m.location] ?? "", unitType: normalizeUnitType(data[m.unit_type] ?? ""),
        price: parsePrice(data[m.price] ?? ""), images,
      });
    }
  }
  const doc: DatasetDoc = {
    name: input.name?.trim() || existing?.name || basename(sourceFile, extname(sourceFile)),
    sourceFile, fields, mapping: checked.ok ? checked.mapping : null,
    rowCount: rows.length, missingImages, importedAt: now(),
  };
  await store.datasets.replaceOne({ _id }, doc, { upsert: true });
  await store.rows.deleteMany({ datasetId: _id });
  if (rows.length) await store.rows.insertMany(rows);
  return { ...doc, _id };
}

/** Saves uploaded text into the dataset folder (only .csv/.json, no paths) and returns the stored file name. */
export async function saveUpload(datasetDir: string, filename: string, content: string): Promise<string> {
  const name = basename(filename).replace(/[^\w.\- ]/g, "_");
  if (![".csv", ".json"].includes(extname(name).toLowerCase())) throw new DatasetError("Datasets must be .csv or .json files.");
  await mkdir(datasetDir, { recursive: true });
  await writeFile(join(datasetDir, name), content, "utf8");
  return name;
}

export type SearchFilters = {
  location?: string | undefined;
  unitType?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  limit?: number | undefined;
  sort?: "price_asc" | "price_desc" | undefined;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Rows of one Dataset matching the filters. Location matches when every word of it appears in the row's location. */
export async function searchListings(store: AgentsStore, datasetId: ObjectId, filters: SearchFilters, mapping?: FieldMapping | null): Promise<Listing[]> {
  const query: Record<string, unknown> = { datasetId };
  const and: Record<string, unknown>[] = [];
  for (const word of (filters.location ?? "").split(/[\s,]+/).filter((w) => w.length > 0)) {
    and.push({ location: { $regex: escapeRegExp(word), $options: "i" } });
  }
  if (filters.unitType) query.unitType = { $regex: `^${escapeRegExp(normalizeUnitType(filters.unitType))}$`, $options: "i" };
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    query.price = { ...(filters.minPrice !== undefined ? { $gte: filters.minPrice } : {}), ...(filters.maxPrice !== undefined ? { $lte: filters.maxPrice } : {}) };
  }
  if (and.length) query.$and = and;
  const limit = Math.max(1, Math.min(filters.limit ?? 5, 20));
  const m = mapping ?? (await store.datasets.findOne({ _id: datasetId }))?.mapping ?? null;
  const rows = await store.rows.find(query).sort({ price: filters.sort === "price_desc" ? -1 : 1, index: 1 }).limit(limit).toArray();
  return rows.map((row) => toListing(row, m));
}

export function toListing(row: DatasetRowDoc & { _id: ObjectId }, mapping: FieldMapping | null): Listing {
  return {
    id: row._id.toHexString(),
    location: row.location,
    unitType: row.unitType,
    price: row.price,
    priceText: mapping ? (row.data[mapping.price] ?? "") : "",
    payment: mapping ? (row.data[mapping.payment] ?? "") : "",
    images: row.images.map((i) => (i.startsWith("images/") ? i : `images/${i}`)),
    data: row.data,
  };
}

export async function getListing(store: AgentsStore, datasetId: ObjectId, id: string): Promise<Listing | null> {
  if (!ObjectId.isValid(id) || id.length !== 24) return null;
  const row = await store.rows.findOne({ _id: new ObjectId(id), datasetId });
  if (!row) return null;
  return toListing(row, (await store.datasets.findOne({ _id: datasetId }))?.mapping ?? null);
}
