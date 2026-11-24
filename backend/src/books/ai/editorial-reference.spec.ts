import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { EDITORIAL_STYLE_REFERENCE, buildEditorialSystemPrompt } from './editorial-reference.js';

describe('editorial style reference (single source)', () => {
  it('builds the system prompt verbatim from the reference', () => {
    const prompt = buildEditorialSystemPrompt();

    expect(prompt.split('\n')[0]).toBe(EDITORIAL_STYLE_REFERENCE.role);
    expect(prompt).toContain(EDITORIAL_STYLE_REFERENCE.securityBoundary);
    expect(prompt).toContain(`1. quality: ${EDITORIAL_STYLE_REFERENCE.qualityLabel}:`);
    for (const level of EDITORIAL_STYLE_REFERENCE.qualityRubric) {
      expect(prompt).toContain(`   - ${level.score}: ${level.description}`);
    }
    expect(prompt).toContain(`2. safety: ${EDITORIAL_STYLE_REFERENCE.safetyRule}`);
    expect(prompt.split('\n').at(-1)).toContain(EDITORIAL_STYLE_REFERENCE.outputShape);
  });

  it('keeps the rubric a complete 1..5 ladder', () => {
    expect(EDITORIAL_STYLE_REFERENCE.qualityRubric.map((level) => level.score)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('says security is explicitly not the model\'s job', () => {
    expect(EDITORIAL_STYLE_REFERENCE.securityBoundary).toContain('firewall');
    expect(EDITORIAL_STYLE_REFERENCE.inputs.maxCharacters).toBeGreaterThan(0);
  });

  it('propagates a custom reference deterministically', () => {
    const custom = {
      ...EDITORIAL_STYLE_REFERENCE,
      role: 'custom role',
      qualityRubric: [{ score: 4 as const, description: 'custom level' }],
    };

    const prompt = buildEditorialSystemPrompt(custom);

    expect(prompt.split('\n')[0]).toBe('custom role');
    expect(prompt).toContain('   - 4: custom level');
    expect(prompt).not.toContain('texto roto');
  });
});
