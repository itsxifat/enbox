import { Router } from 'express';
import { linkPreviewQuerySchema } from '@enbox/shared';
import { linkPreviewLimiter } from '../../lib/rateLimit.js';
import { parse } from '../../lib/validate.js';
import { getLinkPreview } from '../../services/linkPreviews.js';

/**
 * Link previews module — owns: GET /link-preview?url= → `{ preview: LinkPreview | null }`
 * (services/linkPreviews.ts fetches, guards and caches). Null — never an error — for a link
 * without a preview, so clients simply show none.
 */
export const router = Router();

router.get('/link-preview', linkPreviewLimiter, async (req, res) => {
  const { url } = parse(linkPreviewQuerySchema, req.query);
  const preview = await getLinkPreview(url);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.json({ preview });
});
