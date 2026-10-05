/**
 * Realtime Service Types
 * Type definitions for WebSocket monitoring and statistics
 */

// ============================================================================
// Connection Types
// ============================================================================

export type RoomType = "customer" | "kitchen" | "admin";

export interface ConnectionInfo {
  id: string;
  type: RoomType;
  role?: "customer" | "staff" | "admin";
  connectedAt: string;
  lastActivity: string;
  lastEventId?: string;
}

export interface RoomStats {
  roomType: RoomType;
  connectionCount: number;
  connections?: ConnectionInfo[];
  eventHistorySize?: number;
  status: "active" | "inactive" | "error";
  uptime?: number;
}

// ============================================================================
// Overview Types
// ============================================================================

export interface RealtimeOverview {
  restaurantId: string;
  timestamp: string;
  totalConnections: number;
  roomStats: RoomStats[];
  health: RealtimeHealthStatus;
}

export interface RealtimeHealthStatus {
  status: "healthy" | "idle" | "degraded" | "unhealthy";
  lastChecked: string;
  realtimeService?: "up" | "down" | "unreachable";
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface RealtimeMetrics {
  timestamp: number;
  connections: {
    total: number;
    byType: Record<RoomType, number>;
    peak: number;
    peakTime: string;
  };
  messages: {
    sent: number;
    received: number;
    perSecond: number;
  };
  latency: {
    average: number;
    p95: number;
    p99: number;
  };
  errors: {
    connectionErrors: number;
    messageErrors: number;
    authErrors: number;
  };
}

// ============================================================================
// Event Types
// ============================================================================

export interface RealtimeEvent {
  type: string;
  eventId: string;
  timestamp: number;
  restaurantId: string;
  data: Record<string, unknown>;
}

export interface EventHistoryParams {
  roomType: RoomType;
  roomId: string;
  sinceEventId?: string;
  limit?: number;
}

// ============================================================================
// Service Response Types
// ============================================================================

export interface RealtimeStatsResponse {
  success: boolean;
  data?: RoomStats;
  error?: string;
}

export interface RealtimeOverviewResponse {
  success: boolean;
  data?: RealtimeOverview;
  error?: string;
}

export interface RealtimeHealthResponse {
  success: boolean;
  data?: {
    status: string;
    realtimeService: string;
    version?: string;
    environment?: string;
    timestamp: string;
  };
  error?: string;
}
