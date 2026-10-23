import { describe, expect, it } from 'vitest';
import { createAutoModRuleSchema, updateAutoModRuleSchema, updateSpaceCommunitySchema } from './community.js';

describe('AutoMod rule schemas', () => {
  it('fills the defaults on create only: an update carries just the keys sent', () => {
    const created = createAutoModRuleSchema.parse({
      name: 'Words',
      triggerType: 'keyword',
      actions: [{ type: 'block' }],
    });
    expect(created).toMatchObject({ enabled: true, exemptRoleIds: [], exemptChannelIds: [], triggerMetadata: {} });
    expect(updateAutoModRuleSchema.parse({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
  });

  it('refuses an update that changes the trigger type', () => {
    expect(updateAutoModRuleSchema.parse({ triggerType: 'preset', enabled: false })).toEqual({ enabled: false });
  });
});

describe('community settings', () => {
  it('normalises the vanity code and the tags', () => {
    expect(updateSpaceCommunitySchema.parse({ vanityCode: ' Star-Club ', discoveryTags: ['Games'] })).toEqual({
      vanityCode: 'star-club',
      discoveryTags: ['games'],
    });
    expect(updateSpaceCommunitySchema.safeParse({ vanityCode: 'no' }).success).toBe(false);
  });
});
