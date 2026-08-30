import { Suspense, useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./layout/Layout";
import Studio from "./pages/Studio";
import Myvoices from "./pages/Myvoices";
import CreateVoice from "./pages/CreateVoice";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";
import NewProject from "./pages/NewProject";
import VoiceChanger from "./pages/VoiceChanger";
import Publish from "./pages/Publish";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import { isLoggedIn, getCurrentUser, clearToken } from "./lib/backend";
import { Navigate } from "react-router-dom";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: React.ReactElement }) {
  const [state, setState] = useState<"checking" | "ok" | "deny">(
    isLoggedIn() ? "checking" : "deny"
  );

  useEffect(() => {
    let alive = true;
    getCurrentUser()
      .then((user) => {
        if (!alive) return;
        if (user) setState("ok");
        else {
          clearToken();
          setState("deny");
        }
      })
      .catch(() => alive && setState("deny"));
    return () => {
      alive = false;
    };
  }, []);

  if (state === "checking") return <div className="p-6">Loading...</div>;
  if (state === "deny") return <Navigate to="/login" replace />;
  return children;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<div className="p-6">Loading...</div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route element={<Layout />}>
              <Route path="/" element={<RequireAuth><Studio /></RequireAuth>} />
              <Route path="/new-project" element={<RequireAuth><NewProject /></RequireAuth>} />
              <Route path="/voice-changer" element={<RequireAuth><VoiceChanger /></RequireAuth>} />
              <Route path="/publish" element={<RequireAuth><Publish /></RequireAuth>} />
              <Route path="/my-voices" element={<RequireAuth><Myvoices /></RequireAuth>} />
              <Route path="/voices/create" element={<RequireAuth><CreateVoice /></RequireAuth>} />
              <Route path="/projects" element={<RequireAuth><Projects /></RequireAuth>} />
              <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;