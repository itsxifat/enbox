/** What each report category is called and means (the report dialog, Space Settings ▸ Reports). */
import type { ReportCategory, ReportTarget } from '@enbox/shared';

export const CATEGORY_INFO: Record<ReportCategory, { label: string; description: string }> = {
  spam: { label: 'Spam', description: 'Ads, scams, unwanted repeated or automated messages' },
  harassment: {
    label: 'Harassment or bullying',
    description: 'Insults, threats or ganging up on someone',
  },
  hate: { label: 'Hateful content', description: 'Attacks on people for who they are' },
  violence: { label: 'Violence', description: 'Threatening, inciting or glorifying violence' },
  self_harm: {
    label: 'Self-harm or suicide',
    description: 'Someone may be at risk of hurting themselves',
  },
  sexual: { label: 'Sexual content', description: 'Unwanted or explicit sexual content' },
  minor_safety: {
    label: 'Child safety',
    description: 'Anything that endangers or sexualizes a minor',
  },
  illegal: {
    label: 'Illegal activity',
    description: 'Selling drugs, weapons or other illegal goods or services',
  },
  impersonation: {
    label: 'Impersonation',
    description: 'Pretending to be someone else or a brand',
  },
  other: { label: 'Something else', description: 'Tell us more in the next step' },
};

export const TARGET_NOUN: Record<ReportTarget, string> = {
  message: 'Message',
  user: 'User',
  space: 'Space',
};
