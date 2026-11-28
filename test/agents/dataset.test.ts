import { describe, expect, it } from 'vitest';
import { ObjectId } from 'mongodb';
import { useMemoryMongo } from '../fakes/memory-mongo.ts';
import { createAgentsStore, fixtureDir, fixtureDataset, mapping, csv } from './helpers.ts';
import { importDataset, parseDatasetText, searchListings } from '../../src/agents/dataset.ts';

describe('Dataset import and search', () => {
  const database = useMemoryMongo();
  it('imports CSV, normalizes unit types, reports missing images, and keeps exact price/payment', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      const dataset = await fixtureDataset(store, f.dir);
      expect(dataset.rowCount).toBe(2);
      expect(dataset.missingImages).toEqual([{ row: 1, path: 'missing.jpg' }]);
      const found = await searchListings(store, dataset._id, { location: 'MARINA', unitType: '2BR', maxPrice: 6000 });
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ unitType: '2BHK', price: 5500, priceText: 'AED 5,500', payment: 'monthly|yearly' });
      expect(await searchListings(store, dataset._id, { unitType: 'studio', maxPrice: 3000 })).toEqual([]);
    } finally { await f.cleanup(); }
  });
  it('imports JSON with arbitrary fields and re-import replaces rows', async () => {
    const f = await fixtureDir();
    try {
      const store = createAgentsStore(database().db);
      await f.write('homes.json', JSON.stringify([{ area: 'JVC', type: 'two bedroom', rent: 'AED 6000', photos: '', terms: 'yearly' }]));
      const dataset = await importDataset({ store, datasetDir: f.dir, sourceFile: 'homes.json', mapping });
      expect((await searchListings(store, dataset._id, { unitType: '2 bed' }))[0]?.location).toBe('JVC');
      await f.write('homes.json', JSON.stringify([{ area: 'Marina', type: '1BHK', rent: '7000', photos: '', terms: 'monthly' }]));
      await importDataset({ store, datasetDir: f.dir, sourceFile: 'homes.json', datasetId: dataset._id });
      expect(await store.rows.countDocuments({ datasetId: dataset._id })).toBe(1);
      expect(await searchListings(store, dataset._id, { location: 'JVC' })).toEqual([]);
      expect(await searchListings(store, new ObjectId(), {})).toEqual([]);
    } finally { await f.cleanup(); }
  });
  it('rejects malformed CSV and JSON with clear errors', () => {
    expect(() => parseDatasetText('a,b\n"unfinished,b', 'bad.csv')).toThrow(/unterminated/i);
    expect(() => parseDatasetText('a,b\n1', 'bad.csv')).toThrow(/row 2/i);
    expect(() => parseDatasetText('{', 'bad.json')).toThrow(/JSON/i);
    expect(() => parseDatasetText('[1]', 'bad.json')).toThrow(/list of objects/i);
  });
});
