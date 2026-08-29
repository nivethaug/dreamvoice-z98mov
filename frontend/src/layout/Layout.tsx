import { Outlet } from "react-router-dom";
import Sidebar from "./Navbar";

const Layout = () => {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#0a0b0f] text-zinc-100">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Layout;
