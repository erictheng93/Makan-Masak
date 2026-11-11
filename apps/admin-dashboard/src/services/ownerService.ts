import { api, unwrapApiList } from "./api";

export type EmergencyAlertSeverity = "critical" | "high" | "medium" | "low";

export interface EmergencyAlert {
  id: string;
  alertType: string;
  severity: EmergencyAlertSeverity;
  /** English fallback written by the producer; the panel prefers a translation. */
  title: string;
  description: string;
  /** Structured facts the locale strings interpolate. */
  details?: Record<string, unknown> | null;
  createdAt: number;
}

class OwnerService {
  getQuickActionRoute(action: string): string | null {
    const routes: Record<string, string> = {
      "add-staff": "/dashboard/employees",
      "update-menu": "/dashboard/menu",
      "view-reports": "/dashboard/analytics",
      "system-settings": "/dashboard/settings",
    };
    return routes[action] ?? null;
  }

  /** Operational alerts for the selected restaurant; the API pins owners to their own tenant. */
  async listEmergencyAlerts(restaurantId: string): Promise<EmergencyAlert[]> {
    const response = await api.get<EmergencyAlert[]>("/alerts", {
      params: { restaurantId },
    });
    return unwrapApiList<EmergencyAlert>(response.data);
  }

  async resolveEmergencyAlert(
    alertId: string,
    restaurantId: string,
  ): Promise<void> {
    await api.post(`/alerts/${alertId}/resolve`, undefined, {
      params: { restaurantId },
    });
  }

  async escalateEmergencyAlert(
    alertId: string,
    restaurantId: string,
  ): Promise<void> {
    await api.post(`/alerts/${alertId}/escalate`, undefined, {
      params: { restaurantId },
    });
  }
}

export const ownerService = new OwnerService();
export default ownerService;
