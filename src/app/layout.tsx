import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: '灵笔工作室',
    template: '%s | 灵笔工作室',
  },
  description:
    '资料理解与内容创作工作台，支持用户自带 API Base 和 API Key，提供来源管理、证据问答、报告生成、PPT制作、音频合成等能力。',
  keywords: [
    '资料工作台',
    '资料问答',
    'PPT生成',
    '语音合成',
    '资料理解',
    '知识管理',
    '知识卡片',
  ],
  authors: [{ name: '灵笔工作室' }],
  generator: '灵笔工作室',
  icons: {
    icon: [
      { url: '/assets/brand/favicon.png', sizes: '32x32', type: 'image/png' },
      { url: '/assets/brand/lingbi-icon-64.png', sizes: '64x64', type: 'image/png' },
    ],
    apple: [
      { url: '/assets/brand/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  openGraph: {
    title: '灵笔工作室',
    description:
      '资料理解、证据问答、报告生成、PPT制作和音频合成一体化工作台。',
    url: process.env.NEXT_PUBLIC_DOMAIN || 'https://lingbi.example.com',
    siteName: '灵笔工作室',
    locale: 'zh_CN',
    type: 'website',
  },
  // twitter: {
  //   card: 'summary_large_image',
  //   title: 'Lingbi Studio',
  //   description:
  //     'Build and deploy full-stack applications through AI conversation. No env setup, just flow.',
  //   // images: [''],
  // },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]">
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}})()` }} />
        {children}
      </body>
    </html>
  );
}
