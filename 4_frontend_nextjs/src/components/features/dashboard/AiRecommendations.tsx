import { Sparkles, TrendingUp } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { aiRecommendations } from './mockData';

const confidenceVariant = {
  High: 'success',
  Medium: 'warning',
  Low: 'neutral',
} as const;

export function AiRecommendations() {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="flex flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            AI Optimization
          </CardTitle>
          <CardDescription>Suggested actions from the pricing &amp; allocation engine</CardDescription>
        </div>
        <Badge variant="primary">Preview</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {aiRecommendations.map((rec) => (
          <div
            key={rec.title}
            className="rounded-lg border border-border bg-muted/40 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-foreground text-pretty">{rec.title}</p>
              <Badge variant={confidenceVariant[rec.confidence]}>{rec.confidence}</Badge>
            </div>
            <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{rec.detail}</p>
            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success">
                <TrendingUp className="size-3.5" />
                {rec.impact}
              </span>
              <Button variant="ghost" size="sm" disabled>
                Review
              </Button>
            </div>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          Recommendations are illustrative only. The optimization engine is not connected yet.
        </p>
      </CardContent>
    </Card>
  );
}
