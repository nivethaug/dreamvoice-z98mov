import { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "./layout/Layout";
import Studio from "./pages/Studio";
import Myvoices from "./pages/Myvoices";
import Projects from "./pages/Projects";
import Settings from "./pages/Settings";
import NewProject from "./pages/NewProject";
import VoiceChanger from "./pages/VoiceChanger";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<div className="p-6">Loading...</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Studio />} />
              <Route path="/new-project" element={<NewProject />} />
              <Route path="/voice-changer" element={<VoiceChanger />} />
              <Route path="/my-voices" element={<Myvoices />} />
              <Route path="/projects" element={<Projects />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;