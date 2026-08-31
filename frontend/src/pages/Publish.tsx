import { Youtube, ArrowLeft, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const Publish = () => {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl items-center p-4 md:p-8" data-testid="publish-page">
      <Card className="w-full border-border bg-muted/30">
        <CardContent className="flex flex-col items-center gap-4 p-10 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400">
            <Youtube className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Publish to YouTube</h1>
          <p className="max-w-md text-sm text-muted-foreground">
            YouTube publishing is coming soon. Your converted voice project will appear here, ready to publish with title,
            description, and thumbnail.
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate("/voice-changer")} className="gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Voice Changer
            </Button>
            <Button className="gap-2 bg-primary text-primary-foreground hover:bg-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" /> Coming Soon
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Publish;
