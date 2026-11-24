import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EDITORIAL_SYSTEM_PROMPT } from './ai-analysis.prompt.js';
import { buildEditorialSystemPrompt } from './editorial-reference.js';

describe('editorial prompt identity (S5)', () => {
  it('derives EDITORIAL_SYSTEM_PROMPT from the single-source editorial reference', () => {
    expect(EDITORIAL_SYSTEM_PROMPT).toBe(buildEditorialSystemPrompt());
    expect(EDITORIAL_SYSTEM_PROMPT).toContain('documento personal');
    expect(EDITORIAL_SYSTEM_PROMPT).toContain('CUALQUIER libro o material de lectura real');
  });
});
