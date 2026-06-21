import { NextRequest, NextResponse } from 'next/server';
import { generateImage } from '@/lib/ai-service';

export async function POST(request: NextRequest) {
  try {
    const { prompt, style, size } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: '缺少图片描述' }, { status: 400 });
    }

    const enhancedPrompt = `Academic research illustration, professional scientific style, clean layout with labels and annotations. ${style || 'Research framework diagram'}. ${prompt}. High quality, vector-like, suitable for academic presentation.`;

    const result = await generateImage(enhancedPrompt, {
      size: size || '2K',
    });

    if (!result.urls || result.urls.length === 0) {
      return NextResponse.json({ error: '图片生成失败，未返回图片URL' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      urls: result.urls,
      prompt: enhancedPrompt,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '图片生成失败';
    console.error('[Image Generation API Error]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
