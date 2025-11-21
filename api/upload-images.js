// Vercel Serverless Function for uploading images to Shopify
// This endpoint handles multiple image uploads to Shopify Admin API

export default async function handler(req, res) {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { images } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Images array is required' });
    }

    // Get Shopify credentials from environment variables
    const shopifyStore = process.env.SHOPIFY_STORE;
    const shopifyAccessToken = process.env.SHOPIFY_ACCESS_TOKEN;

    if (!shopifyStore || !shopifyAccessToken) {
      return res.status(500).json({ 
        error: 'Shopify credentials not configured. Please set SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN environment variables.' 
      });
    }

    // Remove 'https://' or 'http://' if present and ensure proper format
    const storeDomain = shopifyStore.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const apiUrl = `https://${storeDomain}/admin/api/2024-01/files.json`;

    // Upload all images
    const uploadPromises = images.map(async (imageData) => {
      try {
        // Extract base64 data
        const base64Data = imageData.includes(',') 
          ? imageData.split(',')[1] 
          : imageData;

        // Determine file extension from data URL or default to jpg
        let filename = `image-${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
        let contentType = 'image/jpeg';

        if (imageData.startsWith('data:')) {
          const matches = imageData.match(/data:([^;]+);base64/);
          if (matches) {
            contentType = matches[1];
            const ext = contentType.split('/')[1] || 'jpg';
            filename = `image-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
          }
        }

        // Convert base64 to buffer
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Create multipart/form-data with proper boundary
        // Boundary must not contain spaces and should be unique
        const boundary = `----WebKitFormBoundary${Math.random().toString(36).substring(2, 15)}${Date.now()}`;
        
        // Build multipart body
        const CRLF = '\r\n';
        const bodyParts = [];
        
        // Add file field
        bodyParts.push(`--${boundary}${CRLF}`);
        bodyParts.push(`Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}`);
        bodyParts.push(`Content-Type: ${contentType}${CRLF}${CRLF}`);
        bodyParts.push(imageBuffer);
        bodyParts.push(`${CRLF}--${boundary}--${CRLF}`);

        // Combine into single buffer
        const bodyBuffer = Buffer.concat(
          bodyParts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf-8'))
        );

        // Upload to Shopify
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyAccessToken,
            'Accept': 'application/json',
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          },
          body: bodyBuffer,
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Shopify API error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        return {
          success: true,
          url: result.file.url,
          filename: result.file.key,
          size: result.file.size,
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
        };
      }
    });

    // Wait for all uploads to complete
    const results = await Promise.all(uploadPromises);

    // Check if all uploads succeeded
    const failedUploads = results.filter(r => !r.success);
    if (failedUploads.length > 0) {
      return res.status(207).json({
        message: 'Some uploads failed',
        results,
        failedCount: failedUploads.length,
      });
    }

    // All uploads succeeded
    return res.status(200).json({
      message: 'All images uploaded successfully',
      results,
      count: results.length,
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message 
    });
  }
}

