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
export interface Env {
    DB: D1Database;
    IMAGEKIT_URL_ENDPOINT: string;
    // IMAGEKIT_PRIVATE_KEY: string; // Sẽ được truy cập qua env object nếu dùng secret
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	if (request.method === 'OPTIONS') {
            return createCorsResponse(null, { status: 204 });
        }

        const url = new URL(request.url);
        const { pathname, searchParams } = url;

        // Định tuyến đơn giản
        if (url.pathname === '/api/daily-content') {
            return handleGetDailyContent(request, env);
        }
        if (url.pathname === '/api/soundscapes') {
            return handleGetSoundscapes(request, env);
        }
        
        return createCorsResponse('Not Found', { status: 404 });
    },
};

function createCorsResponse(body: any, options: ResponseInit = {}): Response {
    const defaultHeaders = {
        // Cho phép mọi nguồn gốc.
        // Trong sản phẩm thực tế, bạn nên giới hạn lại:
        // 'Access-Control-Allow-Origin': 'chrome-extension://your-extension-id',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS', // Các method bạn cho phép
        'Access-Control-Allow-Headers': 'Content-Type', // Các header client được gửi
    };

    const mergedHeaders = new Headers({ ...defaultHeaders, ...options.headers });

    // Nếu body là object, tự động chuyển thành JSON
    const responseBody = typeof body === 'object' && body !== null ? JSON.stringify(body) : body;
    if (typeof body === 'object' && body !== null) {
        mergedHeaders.set('Content-Type', 'application/json');
    }

    return new Response(responseBody, { ...options, headers: mergedHeaders });
}

function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0; // Chuyển thành số nguyên 32-bit
    }
    return Math.abs(hash);
}


async function handleGetDailyContent(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const category = searchParams.get('category') || 'cat';

    if (!userId) {
        return createCorsResponse({ error: 'User ID is required' }, { status: 400 });
    }

    // Lấy ngày hiện tại theo giờ UTC để đảm bảo nhất quán toàn cầu
    const today = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    
    try {
        // Query song song để lấy tổng số lượng content
        const [imageCountResult, factCountResult] = await Promise.all([
            env.DB.prepare(`SELECT COUNT(*) as count FROM Images WHERE category = ?1 AND is_active = TRUE`).bind(category).first<{ count: number }>(),
            env.DB.prepare(`SELECT COUNT(*) as count FROM Facts WHERE category = ?1 AND is_active = TRUE`).bind(category).first<{ count: number }>()
        ]);

        const totalImages = imageCountResult?.count ?? 0;
        const totalFacts = factCountResult?.count ?? 0;

        if (totalImages === 0 || totalFacts === 0) {
            return createCorsResponse({ error: 'Not enough content for this category' }, { status: 404 });
        }

        // Tạo "hạt giống" và tính toán vị trí
        const imageSeed = `${userId}-${today}-image`;
        const factSeed = `${userId}-${today}-fact`;
        
        const imageOffset = simpleHash(imageSeed) % totalImages;
        const factOffset = simpleHash(factSeed) % totalFacts;

        // Lấy chính xác content tại vị trí đã tính toán
        const [imageResult, factResult] = await Promise.all([
            env.DB.prepare(`SELECT * FROM Images WHERE category = ?1 AND is_active = TRUE LIMIT 1 OFFSET ?2`)
                .bind(category, imageOffset)
                .first(),
            env.DB.prepare(`SELECT * FROM Facts WHERE category = ?1 AND is_active = TRUE LIMIT 1 OFFSET ?2`)
                .bind(category, factOffset)
                .first()
        ]);

        // Xây dựng URL cho ảnh
        const imageUrl = imageResult ? `${env.IMAGEKIT_URL_ENDPOINT}${imageResult.imagekit_file_id}` : null;
        const attribution = imageResult ? { photographer_name: imageResult.photographer_name, source_url: imageResult.source_url } : null;

        // Trả về một object duy nhất
        return createCorsResponse({
            image: {
                url: imageUrl,
                attribution: attribution
            },
            fact: factResult
        });

    } catch (e: any) {
        console.error("Daily Content Error:", e.message);
        return createCorsResponse({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// Lấy danh sách TẤT CẢ các Soundscapes
async function handleGetSoundscapes(request: Request, env: Env): Promise<Response> {
    try {
        const stmt = env.DB.prepare(`SELECT key, name, imagekit_file_id FROM Soundscapes WHERE is_active = TRUE`);
        const { results } = await stmt.all<{ key: string, name: string, imagekit_file_id: string }>();

        if (!results || results.length === 0) {
            return createCorsResponse({ error: 'No soundscapes found' }, { status: 404 });
        }

        // Xây dựng URL đầy đủ cho mỗi soundscape
        const soundscapesWithUrls = results.map(scape => {
            // ImageKit cũng có thể phân phối các loại file khác, không chỉ ảnh.
            // Chúng ta chỉ cần URL trực tiếp, không cần transformation.
            const audio_url = `${env.IMAGEKIT_URL_ENDPOINT}${scape.imagekit_file_id}`;
            return {
                key: scape.key,
                name: scape.name,
                audio_url: audio_url
            };
        });

        return createCorsResponse(soundscapesWithUrls, { 
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=86400' // Cache 1 ngày
            }
        });
    } catch (e) {
        console.error("Soundscape fetch error:", e);
        return createCorsResponse({ error: 'Internal Server Error' }, { status: 500 });
    }
}


