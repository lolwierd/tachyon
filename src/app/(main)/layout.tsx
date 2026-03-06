import { Sidebar } from "@/components/sidebar";
import { BottomTabs } from "@/components/bottom-tabs";
import { GlobalHotkeys } from "@/components/global-hotkeys";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <GlobalHotkeys />
      <Sidebar />

      <main className="flex-1 overflow-x-hidden pb-16 md:pb-0 md:pl-[var(--sidebar-collapsed)]">
        <div className="mx-auto max-w-6xl animate-[fade-up-in_220ms_ease-out] px-4 py-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      <BottomTabs />
    </div>
  );
}
