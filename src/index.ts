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
        if (pathname.startsWith('/api/background')) {
            return handleGetBackground(request, env);
        }
        if (pathname === '/api/fact') {
            return handleGetFact(request, env);
        }
        if (pathname === '/api/inspiration') {
            return handleGetInspiration(request, env);
        }
        if (pathname === '/api/soundscapes') {
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

async function handleGetBackground(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') || 'cat'; // Mặc định là 'cat'

    if (!['cat', 'dog'].includes(category)) {
        return new Response('Invalid category', { status: 400 });
    }

    try {
        // Query D1 để lấy ngẫu nhiên 1 ảnh thuộc category
        // ORDER BY RANDOM() là một tính năng hiệu quả của SQLite
        const stmt = env.DB.prepare(
            `SELECT imagekit_file_id FROM Images WHERE category = ?1 AND is_active = TRUE ORDER BY RANDOM() LIMIT 1`
        );
        const result = await stmt.bind(category).first<{ imagekit_file_id: string }>();

        if (!result) {
            return new Response(`No images found for category: ${category}`, { status: 404 });
        }

        // Tạo URL tối ưu bằng endpoint của ImageKit
        // Đây là cách tạo URL không cần SDK, chỉ cần nối chuỗi
        // tr:w-1920,q-80,f-auto => Transformation
        const optimizedUrl = `${env.IMAGEKIT_URL_ENDPOINT}/tr:w-1920,q-80,f-auto${result.imagekit_file_id}`;

        const responseData = {
            url: optimizedUrl,
            // Thêm các thông tin khác nếu cần
            // photographer: result.photographer_name
        };

        // Trả về JSON cho client
	return createCorsResponse(responseData, {
            status: 200,
            headers: {
                'Cache-Control': 'public, max-age=3600'
            }
        });

    } catch (e: any) {
        console.error("D1 Query Error:", e.message);
	return createCorsResponse('Internal Server Error', { status: 500 });
    }
}

async function handleGetFact(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    // Cho phép client lọc theo category, ví dụ /api/fact?category=cat
    const category = searchParams.get('category'); 

    try {
        let stmt;
        if (category && ['cat', 'dog', 'general'].includes(category)) {
            stmt = env.DB.prepare(`SELECT content, category FROM Facts WHERE category = ?1 AND is_active = TRUE ORDER BY RANDOM() LIMIT 1`);
            stmt = stmt.bind(category);
        } else {
            // Nếu không có category, lấy ngẫu nhiên từ tất cả
            stmt = env.DB.prepare(`SELECT content, category FROM Facts WHERE is_active = TRUE ORDER BY RANDOM() LIMIT 1`);
        }
        
        const result = await stmt.first<{ content: string; category: string }>();

        if (!result) {
            return createCorsResponse({ error: 'No facts found' }, { status: 404 });
        }
        return createCorsResponse(result, { status: 200 });
    } catch (e) {
        return createCorsResponse({ error: 'Internal Server Error' }, { status: 500 });
    }
}

// Lấy ngẫu nhiên một Inspiration
async function handleGetInspiration(request: Request, env: Env): Promise<Response> {
    try {
        const stmt = env.DB.prepare(`SELECT content, author FROM Inspirations WHERE is_active = TRUE ORDER BY RANDOM() LIMIT 1`);
        const result = await stmt.first<{ content: string; author: string | null }>();

        if (!result) {
            return createCorsResponse({ error: 'No inspirations found' }, { status: 404 });
        }
        return createCorsResponse(result, { status: 200 });
    } catch (e) {
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
            const audio_url = `${env.IMAGEKIT_URL_ENDPOINT.slice(0, -1)}${scape.imagekit_file_id}`;
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


