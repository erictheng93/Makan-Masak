import { api, unwrapApiList } from "./api";

export type EmergencyAlertSeverity = "critical" | "high" | "medium" | "low";

export interface EmergencyAlert {
  id: string;
  alertType: string;
  severity: EmergencyAlertSeverity;
  title: string;
  description: string;
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

  /** Open operational alerts for the signed-in owner's restaurant (#285). */
  async listEmergencyAlerts(): Promise<EmergencyAlert[]> {
    const response = await api.get<EmergencyAlert[]>("/alerts");
    return unwrapApiList<EmergencyAlert>(response.data);
  }

  async resolveEmergencyAlert(alertId: string): Promise<void> {
    await api.post(`/alerts/${alertId}/resolve`);
  }

  async escalateEmergencyAlert(alertId: string): Promise<void> {
    await api.post(`/alerts/${alertId}/escalate`);
  }
}

export const ownerService = new OwnerService();
export default ownerService;
