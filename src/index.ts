/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// my-pet-extension-worker/src/index.ts

// Định nghĩa môi trường để TypeScript nhận diện các bindings
/**
 * Cloudflare Worker for PetTabs Extension
 * 
 * Acts as a secure backend API providing daily content and proxying media requests.
 * Key Features:
 * - Serves daily, user-specific content (image & fact) from a D1 database.
 * - Provides a list of soundscapes for the Zen Mode.
 * - Securely proxies image requests to hide transformation logic and prevent abuse.
 *   It uses internally-generated Cloudflare Signed URLs.
 */

// --- TYPE DEFINITIONS & INTERFACES ---

/**
 * Defines the environment variables and bindings available to the Worker.
 * These are configured in the `wrangler.jsonc` file and Cloudflare Dashboard.
 */
export interface Env {
    // D1 Database binding for storing metadata.
    DB: D1Database;
    PETTABS_IMAGE_CDN: string;
    PETTABS_AUDIO_CDN: string;
}

/**
 * Pre-defined image transformation presets.
 * This allows for clean URLs and centralized management of image sizes/formats.
 */
const IMAGE_PRESETS: { [key: string]: string } = {
    'large': 'width=2560,quality=80,format=webp',
};


// --- MAIN WORKER ENTRY POINT ---

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Handle CORS pre-flight requests.
        if (request.method === 'OPTIONS') {
            return createCorsResponse(null, { status: 204 });
        }

        const url = new URL(request.url);

        // --- API ROUTING ---
        if (url.pathname === '/api/daily-content') {
            return handleGetDailyContent(request, env);
        }
        if (url.pathname === '/api/soundscapes') {
            return handleGetSoundscapes(request, env);
        }
        // Secure Image Proxy Route
        if (url.pathname.startsWith('/v1/image/')) {
            return handleImageProxy(request, env);
        }
        
        // Fallback for any other route
        return createCorsResponse({ error: 'Not Found' }, { status: 404 });
    },
};


// --- ROUTE HANDLERS ---

/**
 * Fetches the daily image and fact for a given user and category.
 * The content is deterministic for a user for the entire day.
 */
async function handleGetDailyContent(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const category = searchParams.get('category') || 'cat';

    if (!userId) {
        return createCorsResponse({ error: 'User ID is required' }, { status: 400 });
    }

    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD" in UTC
    
    try {
        const [imageCountResult, factCountResult] = await Promise.all([
            env.DB.prepare(`SELECT COUNT(*) as count FROM Images WHERE category = ?1 AND is_active = TRUE`).bind(category).first<{ count: number }>(),
            env.DB.prepare(`SELECT COUNT(*) as count FROM Facts WHERE category = ?1 AND is_active = TRUE`).bind(category).first<{ count: number }>()
        ]);

        const totalImages = imageCountResult?.count ?? 0;
        const totalFacts = factCountResult?.count ?? 0;

        if (totalImages === 0 || totalFacts === 0) {
            return createCorsResponse({ error: 'Not enough content for this category' }, { status: 404 });
        }

        const imageSeed = `${userId}-${today}-image`;
        const factSeed = `${userId}-${today}-fact`;
        
        const imageOffset = simpleHash(imageSeed) % totalImages;
        const factOffset = simpleHash(factSeed) % totalFacts;

        const [imageResult, factResult] = await Promise.all([
            env.DB.prepare(`SELECT file_path, photographer_name, source_url FROM Images WHERE category = ?1 AND is_active = TRUE LIMIT 1 OFFSET ?2`)
                .bind(category, imageOffset)
                .first<{ file_path: string, photographer_name: string, source_url: string }>(),
            env.DB.prepare(`SELECT * FROM Facts WHERE category = ?1 AND is_active = TRUE LIMIT 1 OFFSET ?2`)
                .bind(category, factOffset)
                .first()
        ]);

        // Return a "clean" URL path. The client will prepend the Worker's base URL.
        const imageUrlPath = imageResult ? `/v1/image/large/${imageResult.file_path.replace(/^\/+/, '')}` : null;
        const attribution = imageResult ? { photographer_name: imageResult.photographer_name, source_url: imageResult.source_url } : null;

        const responsePayload = {
            image: {
                url: imageUrlPath,
                attribution: attribution
            },
            fact: factResult
        }

        return createCorsResponse(responsePayload, {
            status: 200,
            headers: { 'Cache-Control': 'public, max-age=3600' } // Cache for 1 hour
        });

    } catch (e: any) {
        console.error("Daily Content Error:", e.message);
        return createCorsResponse({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Fetches the list of all active soundscapes.
 */
async function handleGetSoundscapes(request: Request, env: Env): Promise<Response> {
    try {
        const { results } = await env.DB.prepare(`SELECT key, name, file_path FROM Soundscapes WHERE is_active = TRUE`).all<{ key: string, name: string, file_path: string }>();

        if (!results || results.length === 0) {
            return createCorsResponse({ error: 'No soundscapes found' }, { status: 404 });
        }

        const soundscapesWithUrls = results.map(scape => ({
            key: scape.key,
            name: scape.name,
            // Return the full, direct URL to the audio file.
            audio_url: `${env.PETTABS_AUDIO_CDN}${scape.file_path}`
        }));

        return createCorsResponse(soundscapesWithUrls, { 
            status: 200,
            headers: { 'Cache-Control': 'public, max-age=86400' } // Cache for 1 day
        });
    } catch (e) {
        console.error("Soundscape fetch error:", e);
        return createCorsResponse({ error: 'Internal Server Error' }, { status: 500 });
    }
}

/**
 * Securely proxies an image request.
 * It translates a clean URL like `/v1/image/large/cat/photo.jpg` into a
 * fully-formed, signed Cloudflare Image Resizing URL, fetches it, and
 * streams the result back to the client.
 */
async function handleImageProxy(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathParts = url.pathname.substring('/v1/image/'.length).split('/');
    
    const preset = pathParts[0];
    const filePath = pathParts.slice(1).join('/');

    if (!preset || !filePath || !IMAGE_PRESETS[preset]) {
        return new Response('Invalid image request: preset or file path is missing or invalid.', { status: 400 });
    }

    const transformation = IMAGE_PRESETS[preset];
    const imageUrl = `${env.PETTABS_IMAGE_CDN}/cdn-cgi/image/${transformation}/${filePath}`;

    // Fetch the image from the CDN using the secure, signed URL.
    // The `cf` object is used to instruct Cloudflare's edge to cache the result.
    const imageResponse = await fetch(imageUrl, {
        cf: {
            cacheTtlByStatus: { '200-299': 86400 * 7, '404': 60, '500-599': 0 }, // Cache successful images for 7 days
        },
    });

    // We must create a new response to add our own headers (like CORS).
    const response = new Response(imageResponse.body, imageResponse);
    response.headers.set('Access-Control-Allow-Origin', '*'); // Or your specific extension origin
    response.headers.set('Cache-Control', 'public, max-age=86400'); // Tell the browser to cache for 1 day
    
    return response;
}


// --- UTILITY FUNCTIONS ---

/**
 * Creates a response with appropriate CORS headers.
 */
function createCorsResponse(body: any, options: ResponseInit = {}): Response {
    const defaultHeaders = {
        // IMPORTANT: For production, restrict this to your extension's origin.
        // 'Access-Control-Allow-Origin': 'chrome-extension://your-extension-id',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    const mergedHeaders = new Headers({ ...defaultHeaders, ...options.headers });

    const responseBody = typeof body === 'object' && body !== null ? JSON.stringify(body) : body;
    if (typeof body === 'object' && body !== null) {
        mergedHeaders.set('Content-Type', 'application/json');
    }

    return new Response(responseBody, { ...options, headers: mergedHeaders });
}

/**
 * Generates a simple, non-cryptographic hash from a string.
 * Used to create a deterministic index for daily content.
 */
function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}