export default function VirtualClassroomPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] px-6 text-[var(--text-primary)]">
      <section className="liquid-glass-card max-w-xl p-8 text-center">
        <p className="text-sm font-semibold text-[var(--accent-blue)]">虚拟教室</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">从资料工作台进入课堂</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
          请选择资料后生成课程大纲，确认场景后课堂会在工作台中间区域打开。
        </p>
        <a href="/#workbench" className="liquid-glass-btn mt-6 inline-flex px-5 py-3 text-sm font-semibold">
          回到资料工作台
        </a>
      </section>
    </main>
  );
}
