import { drizzle } from "drizzle-orm/d1";
import { auditLogs } from "@makanmasak/database";
import type { Env } from "../../../types/env";
import type { AuthUser } from "../../../middleware/auth";
import { ApiError } from "../../../shared/utils/api-error";
import { MenuService } from "../../menu/services/MenuService";
import type { ManagerActionCommand } from "../schemas/validation";

export interface ManagerActionResult {
  auditLogId: number;
  actorId: string;
  onBehalfOfUserId: string | null;
  action: string;
  resource: string;
  resourceId: string;
  executed: boolean;
}

export class ManagerActionsService {
  private db;

  constructor(private readonly env: Env) {
    this.db = drizzle(env.DB);
  }

  async execute(
    input: ManagerActionCommand,
    actor: AuthUser,
  ): Promise<ManagerActionResult> {
    this.assertActionResourcePair(input.action, input.resource);

    let executed = false;

    if (input.action === "update_menu_availability") {
      executed = await this.updateMenuAvailability(input);
    }

    const description =
      input.reason?.trim() ||
      `${input.action} on ${input.resource}#${input.resourceId}`;

    const [inserted] = await this.db
      .insert(auditLogs)
      .values({
        userId: actor.id,
        onBehalfOfUserId: input.onBehalfOfUserId ?? null,
        restaurantId: input.restaurantId,
        action: input.action,
        resource: input.resource,
        resourceId: input.resourceId,
        description,
        changes: {
          metadata: {
            onBehalfOfUserId: input.onBehalfOfUserId ?? null,
            payload: input.payload ?? null,
            reason: input.reason ?? null,
          },
        },
        success: true,
      })
      .returning({ id: auditLogs.id });

    return {
      auditLogId: Number(inserted.id),
      actorId: actor.id,
      onBehalfOfUserId: input.onBehalfOfUserId ?? null,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId,
      executed,
    };
  }

  private assertActionResourcePair(action: string, resource: string): void {
    if (action === "update_menu_availability" && resource !== "menu_item") {
      throw new ApiError(
        "MANAGER_ACTION_INVALID",
        `Action "${action}" cannot target resource "${resource}"`,
        400,
      );
    }
  }

  private async updateMenuAvailability(
    input: ManagerActionCommand,
  ): Promise<boolean> {
    const menuItemId = Number(input.resourceId);
    if (!Number.isSafeInteger(menuItemId) || menuItemId <= 0) {
      throw new ApiError(
        "MANAGER_ACTION_INVALID",
        "resourceId must be a positive integer for menu_item actions",
        400,
      );
    }

    const menu = new MenuService(this.env);
    const item = await menu.getMenuItem(menuItemId);

    if (!item) {
      throw new ApiError(
        "MENU_ITEM_NOT_FOUND",
        `Menu item ${menuItemId} not found`,
        404,
      );
    }

    if (item.restaurantId !== input.restaurantId) {
      throw new ApiError(
        "FORBIDDEN",
        "Menu item belongs to another restaurant",
        403,
      );
    }

    const payloadIsAvailable =
      input.payload && typeof input.payload.isAvailable === "boolean"
        ? (input.payload.isAvailable as boolean)
        : undefined;
    const targetValue = payloadIsAvailable ?? !item.isAvailable;

    await menu.updateMenuItem(menuItemId, { isAvailable: targetValue }, item);

    return true;
  }
}
