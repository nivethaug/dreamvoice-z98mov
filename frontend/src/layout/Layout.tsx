import { Outlet } from "react-router-dom";
import AppHeader from "./Navbar";

const Layout = () => {
  return (
    <div className="flex min-h-screen w-full flex-col bg-[#0a0b0f] text-zinc-100">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1200px] flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-white/[0.06] py-4">
        <p className="mx-auto max-w-[1200px] px-4 text-xs text-zinc-600 md:px-6">
          DreamVoice — AI voice studio
        </p>
      </footer>
    </div>
  );
};

export default Layout;
