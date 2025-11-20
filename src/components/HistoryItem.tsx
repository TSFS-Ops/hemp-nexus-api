import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Star, RotateCcw, Trash2 } from "lucide-react";

interface RequestHistoryItem {
  id: string;
  timestamp: number;
  endpoint: string;
  method: string;
  body?: any;
  status?: number;
  responseTime?: number;
  isFavorite: boolean;
}

interface HistoryItemProps {
  item: RequestHistoryItem;
  onReplay: (item: RequestHistoryItem) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function HistoryItem({ item, onReplay, onToggleFavorite, onDelete }: HistoryItemProps) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const getStatusColor = (status?: number) => {
    if (!status) return "bg-gray-500";
    if (status >= 200 && status < 300) return "bg-green-600";
    if (status >= 400) return "bg-red-600";
    return "bg-yellow-600";
  };

  return (
    <Card className="p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {item.method}
            </Badge>
            <code className="text-xs font-mono truncate">{item.endpoint}</code>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatTime(item.timestamp)}</span>
            {item.status && (
              <>
                <span>•</span>
                <Badge variant="outline" className={getStatusColor(item.status)}>
                  {item.status}
                </Badge>
              </>
            )}
            {item.responseTime && (
              <>
                <span>•</span>
                <span>{item.responseTime}ms</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onToggleFavorite(item.id)}
          >
            <Star
              className={`h-4 w-4 ${
                item.isFavorite ? "fill-yellow-500 text-yellow-500" : ""
              }`}
            />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onReplay(item)}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
