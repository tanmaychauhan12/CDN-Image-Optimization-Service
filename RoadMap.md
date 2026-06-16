## What this service actually does
A CDN Image Optimization Service accepts raw image uploads from clients, automatically generates multiple resized/compressed/format-converted variants, stores them in private S3, and serves them globally through CloudFront using short-lived signed URLs. The client never touches S3 directly — every read goes through the CDN and every write goes through the API.

## Tech stack, layer by layer
Runtime: Node.js + Express

The API server is the brain. Express handles routing, Multer handles multipart/form-data streaming (images are never fully buffered in memory — they stream from the client directly into the Sharp pipeline), and JWT middleware gates every request before any processing starts.
Image processing: Sharp (backed by libvips)

Sharp is a Node.js wrapper around libvips, a high-performance C image processing library. It does all the heavy lifting: resize, format conversion, quality compression, and metadata stripping. It processes images as streaming pipelines, meaning a 20MB RAW file never fully loads into memory.
Storage: AWS S3

One private bucket acts as the canonical origin. No public access. Object keys follow a deterministic naming scheme: {userId}/{imageId}/{variant}.{ext} — for example u123/img_abc/w800.webp. S3 versioning is enabled so overwrites don't destroy originals.
CDN: AWS CloudFront

CloudFront sits in front of S3 with ~600 global edge locations (Points of Presence). It caches variants at the edge closest to the requesting user. Cache TTLs are set per variant: thumbnails might have a 30-day TTL, while "preview" variants serving editorial content might have 24 hours.
Access control: Signed URLs

CloudFront signed URLs use RSA-2048 key pairs. The API holds the private key and generates signed URLs with baked-in expiry timestamps and IP binding (optional). Clients receive a signed URL valid for, say, 1 hour — after which it 403s. S3 itself is locked behind an Origin Access Control (OAC) policy that only allows CloudFront's service principal to fetch objects.
Metadata: DynamoDB or Redis

After each upload-and-process cycle, a record is written: original filename, all generated variant keys, MIME type, dimensions, upload timestamp, owner ID, and the CloudFront base URL. This is what the API queries when a client requests a signed URL — it looks up the variant key, signs it, and returns it.

## The two core flows
## Flow 1 — Upload path

Client sends POST /upload with multipart/form-data carrying the raw image file.
JWT middleware validates the bearer token. Invalid → 401, done.
Multer begins streaming the upload. Before writing anything, a pre-flight validator reads the first few bytes (magic bytes): FF D8 FF = JPEG, 89 50 4E 47 = PNG, etc. This prevents disguised executables masquerading as images.
The stream is piped into Sharp. Sharp runs the processing pipeline (detailed below) and outputs multiple variant streams simultaneously.
Each variant stream is piped to an S3 PutObject call in parallel using the AWS SDK v3 Upload class (which handles multipart upload for large files automatically).
When all S3 writes confirm, a metadata record is written to DynamoDB: { imageId, ownerId, variants: [{key, width, height, format, sizeBytes}], createdAt }.
The API responds with { imageId, signedUrls: { thumb: "...", medium: "...", original: "..." } }.

## Flow 2 — Serve/request path

Client requests a signed CloudFront URL (either freshly issued or cached in their app).
CloudFront checks its edge cache for that exact URL (cache key = path + query string). Cache HIT → serves immediately from edge, sub-10ms.
Cache MISS → CloudFront forwards the request to the origin (S3). S3 checks the OAC signature, serves the object. CloudFront caches it at the edge for subsequent requests.
Optional: Lambda@Edge intercepts the origin-request event. If the URL carries query params like ?w=400&q=80&fmt=avif, Lambda@Edge can transform the S3 key on the fly, fetch the closest pre-generated variant, or even run a lightweight Sharp transform in the Lambda itself before caching.


## Processing algorithms inside Sharp
When an image hits Sharp, the following pipeline runs:
Resize algorithm: Sharp defaults to Lanczos-3 resampling (a high-quality sinc-windowed interpolation algorithm) for downscaling — it produces minimal aliasing and sharp edges. For thumbnails where speed matters more than quality, you can switch to bilinear. The pipeline runs this operation directly on the pixel buffer in libvips without creating intermediate decoded images in memory.
Format conversion and compression:

JPEG: uses libjpeg-turbo. Quality factor 75–85 is the sweet spot (perceptually lossless for most images). Chroma subsampling (4:2:0) is enabled by default, cutting file size ~30% vs 4:4:4.
WebP: uses Google's libwebp. Lossy WebP at quality 80 typically produces files 25–35% smaller than JPEG at equivalent perceptual quality.
AVIF: uses libaom or libheif. AVIF at quality 60–70 beats WebP by another 20–30% but encoding is CPU-heavy (5–10× slower than WebP).
PNG: uses libpng with zlib compression (level 6–9). Lossless, so size reduction comes only from stripping metadata and applying optipng-style filters.

Metadata stripping: Sharp calls .withMetadata(false) by default, stripping EXIF (GPS coordinates, camera model, timestamps), ICC color profiles (or normalizing to sRGB), and XMP data. This alone can cut 50–200KB from smartphone photos.
Variant matrix generated per upload:
VariantWidthFormatUse casethumb150pxWebPGrid thumbnailssmall400pxWebPMobile feedsmedium800pxWebPStandard weblarge1600pxWebPRetina displaysoriginaloriginalWebP / AVIFFull-res downloadog1200×630pxJPEGOpen Graph / social
All variants are generated in a single Sharp pipeline pass over the source buffer — libvips uses a demand-driven streaming architecture that means the source pixels are read only once, even when producing 6 outputs.

## How cache invalidation works
When an image is updated (re-uploaded), the API has two strategies:
Key-based invalidation (preferred): The S3 object key includes a version token (/img_abc/v2/w800.webp). New upload = new key = no CloudFront invalidation needed. Old signed URLs simply expire. Clean.
CloudFront invalidation (fallback): If key-based versioning isn't possible, the API calls CreateInvalidation on the CloudFront distribution with paths like /img_abc/*. This propagates to all edge locations within ~60 seconds. AWS charges per invalidation path after the first 1,000/month.

## Signed URL internals
A CloudFront signed URL embeds a canned policy or custom policy signed with your RSA-2048 private key. A custom policy looks like:
json{
  "Statement": [{
    "Resource": "https://d1abc.cloudfront.net/img_abc/*",
    "Condition": {
      "DateLessThan": { "AWS:EpochTime": 1718500000 },
      "IpAddress": { "AWS:SourceIp": "203.0.113.0/24" }
    }
  }]
}
This JSON is base64url-encoded, then signed with the private key using SHA-1 (CloudFront's requirement). The resulting URL has three query params appended: Key-Pair-Id, Signature, and Expires. CloudFront's edge validates the signature against the public key registered in your distribution — the private key never leaves your API server.

## How all the pieces connect
Client
  ↓ POST /upload (JWT)
Express + Multer (stream)
  ↓ magic byte check
Sharp pipeline ──→ [thumb, small, medium, large, og] variants
  ↓ parallel PutObject
S3 private bucket
  ↓ event notification (S3 → SNS/SQS, optional async jobs)
DynamoDB (metadata index)
  ↑ query on GET /sign
API signs CloudFront URL → returns to client
  ↓ client requests URL
CloudFront edge (600+ PoPs)
  ↓ cache MISS
S3 via OAC → cached at edge → served
  ↓ optional intercept
Lambda@Edge (on-demand transforms, header rewriting, A/B routing)
