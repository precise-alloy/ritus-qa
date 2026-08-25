import { test, expect } from 'bun:test';
import { sanitizeJiraIssue } from '../scripts/lib/sanitize.ts';

const RAW_ISSUE = {
  key: 'PROJ-123',
  fields: {
    summary: 'Hero banner CTA',
    attachment: [
      {
        id: '145276',
        filename: 'l5HbBARPdP.png',
        author: {
          self: 'https://episerver-services.atlassian.net/rest/api/3/user?accountId=5fd725724d2179006ed28108',
          accountId: '5fd725724d2179006ed28108',
          emailAddress: 'hue.tran@episerver.com',
          avatarUrls: {
            '48x48': 'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/.../48',
            '16x16': 'https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/.../16',
          },
          displayName: 'Hue Tran',
          active: true,
          timeZone: 'Asia/Saigon',
          accountType: 'atlassian',
        },
        created: '2026-08-14T08:41:01.041+0200',
        size: 55323,
        mimeType: 'image/png',
        content: 'https://episerver-services.atlassian.net/rest/api/3/attachment/content/145276',
        thumbnail: 'https://episerver-services.atlassian.net/rest/api/3/attachment/thumbnail/145276',
      },
    ],
  },
};

test('jira attachments are trimmed to a minimal reference, author noise dropped', () => {
  const out = sanitizeJiraIssue(RAW_ISSUE) as { fields: { attachment: Array<Record<string, unknown>> } };
  const att = out.fields.attachment[0];

  // Kept: just enough to identify the file (download goes via attachment-download).
  expect(att.id).toBe('145276');
  expect(att.filename).toBe('l5HbBARPdP.png');
  expect(att.created).toBe('2026-08-14T08:41:01.041+0200');

  // Dropped: fetch metadata and the noisy author identity block.
  expect(att.mimeType).toBeUndefined();
  expect(att.size).toBeUndefined();
  expect(att.content).toBeUndefined();
  expect(att.thumbnail).toBeUndefined();
  expect(att.author).toBeUndefined();
});
