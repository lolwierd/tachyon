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
      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content — offset by collapsed sidebar on desktop, bottom tabs on mobile */}
      <main className="flex-1 pb-16 md:pb-0 md:pl-[var(--sidebar-collapsed)]">
        <div className="mx-auto max-w-6xl animate-[fade-up-in_220ms_ease-out] px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </div>
      </main>

      {/* Mobile bottom tabs */}
      <BottomTabs />
    </div>
  );
}
