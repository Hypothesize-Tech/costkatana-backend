import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { extractLinkMetadata, extractUrlsFromText, isValidUrl } from '../utils/linkMetadata';

const router = Router();

/**
 * POST /api/utils/extract-link-metadata
 * Extract metadata (title, description, image) from a URL
 */
router.post('/extract-link-metadata', authenticate, async (req: Request, res: Response): Promise<Response> => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }

    // Validate URL format
    if (!isValidUrl(url)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format'
      });
    }

    // Extract metadata
    const metadata = await extractLinkMetadata(url);

    return res.json({
      success: true,
      data: metadata
    });
  } catch (error) {
    console.error('Error extracting link metadata:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to extract link metadata',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/utils/extract-urls
 * Extract all URLs from a text string
 */
router.post('/extract-urls', authenticate, async (req: Request, res: Response): Promise<Response> => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }

    const urls = extractUrlsFromText(text);

    return res.json({
      success: true,
      data: {
        urls,
        count: urls.length
      }
    });
  } catch (error) {
    console.error('Error extracting URLs:', error);

    return res.status(500).json({
      success: false,
      error: 'Failed to extract URLs'
    });
  }
});

export default router;

