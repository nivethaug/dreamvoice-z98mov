import { Mic2, ArrowLeft, Sparkles, Info } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const VoiceChanger = () => {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl items-center p-4 md:p-8" data-testid="voice-changer-page">
      <Card className="w-full border-white/10 bg-white/[0.03]">
        <CardContent className="flex flex-col items-center gap-5 p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/30 to-purple-500/30 text-indigo-300">
            <Mic2 className="h-7 w-7" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">Voice Changer</h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-zinc-400">
              Your uploaded media is ready. Voice conversion tooling will be connected here in a
              later step — target voice selection and conversion controls are coming soon.
            </p>
          </div>
          <p className="flex items-center gap-2 rounded-lg border border-indigo-500/25 bg-indigo-500/[0.07] px-3 py-2 text-xs text-indigo-300">
            <Info className="h-3.5 w-3.5" aria-hidden="true" /> Placeholder workspace — no processing yet.
          </p>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => navigate("/new-project")}
              className="gap-2 bg-white/10 text-zinc-200 hover:bg-white/15" data-testid="voice-changer-back-button">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Upload
            </Button>
            <Button disabled className="gap-2 bg-indigo-500/40 text-zinc-300" data-testid="voice-changer-convert-button">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Convert Voice (coming soon)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default VoiceChanger;
