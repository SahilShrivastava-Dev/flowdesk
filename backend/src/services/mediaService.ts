import axios from 'axios';
import { v2 as cloudinary } from 'cloudinary';

const cloudinaryReady = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (cloudinaryReady) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

/**
 * Download a WhatsApp media file from Meta Graph API and upload it to Cloudinary.
 *
 * Flow:
 *  1. GET /v19.0/{mediaId}           → temporary download URL (expires in ~5 min)
 *  2. GET {downloadUrl}              → raw file bytes
 *  3. Upload bytes to Cloudinary     → permanent public URL
 *
 * Returns null if Cloudinary is not configured or any step fails.
 */
export async function storeWhatsAppMedia(mediaId: string): Promise<string | null> {
  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    console.warn('[Media] META_ACCESS_TOKEN not set — skipping media download');
    return null;
  }

  if (!cloudinaryReady) {
    console.warn('[Media] Cloudinary env vars missing — skipping media upload');
    return null;
  }

  try {
    // Step 1: Resolve the temporary download URL from Meta
    const { data: metaInfo } = await axios.get<{ url: string; mime_type: string }>(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // Step 2: Download the actual file as raw bytes
    const fileResponse = await axios.get<ArrayBuffer>(metaInfo.url, {
      headers:      { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    const buffer = Buffer.from(fileResponse.data);

    // Step 3: Upload to Cloudinary — resource_type 'auto' handles images, docs, videos
    const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:        'flowdesk/attachments',
          resource_type: 'auto',
          // Tag with mediaId so duplicates can be found / deduplicated later
          tags: [`whatsapp_media_${mediaId}`],
        },
        (error, result) => {
          if (error || !result) reject(error ?? new Error('Cloudinary upload failed'));
          else resolve(result as { secure_url: string });
        }
      );
      stream.end(buffer);
    });

    console.log(`[Media] Uploaded ${mediaId} → ${uploadResult.secure_url}`);
    return uploadResult.secure_url;
  } catch (err) {
    console.error('[Media] Failed to download/upload WhatsApp media:', err);
    return null;
  }
}
