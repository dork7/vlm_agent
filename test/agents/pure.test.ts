import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseDatasetText } from '../../src/agents/dataset.ts';
import { normalizeUnitType } from '../../src/agents/unit-type.ts';
import { cardCaption } from '../../src/agents/telegram.ts';

describe('Agent Bots pure checks', () => {
  it('rejects malformed CSV and JSON', () => {
    expect(() => parseDatasetText('a,b\n"unfinished,b', 'bad.csv')).toThrow(/unterminated/i);
    expect(() => parseDatasetText('a,b\n1', 'bad.csv')).toThrow(/row 2/i);
    expect(() => parseDatasetText('{', 'bad.json')).toThrow(/JSON/i);
  });
  it('normalizes common unit types and keeps dataset text in cards', () => {
    expect(['2 bed', '2BR', 'two bedroom'].map(normalizeUnitType)).toEqual(['2BHK', '2BHK', '2BHK']);
    const caption = cardCaption({ id: 'x', location: 'Marina', unitType: '2BHK', price: 5500, priceText: 'AED 5,500', payment: 'monthly|yearly', images: [], data: {} });
    expect(caption).toContain('AED 5,500');
    expect(caption).toContain('monthly|yearly');
  });
  it('keeps grammY out of the channel-neutral engine', async () => {
    const source = await readFile(new URL('../../src/agents/engine.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:from|import)\s*\(?["']grammy/);
  });
});
