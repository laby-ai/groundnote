import { NextRequest, NextResponse } from 'next/server';
import { resolveFileUrl, isProduction } from '@/lib/storage';

/**
 * 文件访问路由
 * GET /api/file?key=<s3_key_or_local_path>
 *
 * 开发环境：直接返回本地路径
 * 生产环境：生成 S3 签名 URL 并重定向
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const fileKey = searchParams.get('key');

    if (!fileKey) {
      return NextResponse.json({ error: '缺少 key 参数' }, { status: 400 });
    }

    if (!isProduction()) {
      // 开发环境：文件通过 Next.js 静态服务直接访问，无需重定向
      return NextResponse.json({ url: fileKey });
    }

    // 生产环境：生成签名 URL
    const signedUrl = await resolveFileUrl(fileKey);
    return NextResponse.redirect(signedUrl);
  } catch (error) {
    console.error('[File API Error]', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: '文件访问失败' }, { status: 500 });
  }
}
