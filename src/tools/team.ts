import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "../client.js";
import { formatResponse } from "../utils/formatting.js";
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
} from "../annotations.js";
import { isValidUuid } from "../utils/validation.js";

const customerId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("Your customer UUID (shown in the WARP portal under Settings)");

const userId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("User UUID of the team member (find it via team_list_members)");

const roleId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("Role UUID (find it via team_list_roles)");

export function registerTeamTools(
  server: McpServer,
  client: WarpClient
): void {
  server.registerTool(
    "team_list_members",
    {
      title: "List team members",
      description:
        "List every user holding a role in this customer, alphabetical by email. Use to see who is on the team and which role each member holds, or to find a user UUID for team_update_member_role / team_remove_member. Requires the team:read scope.",
      inputSchema: { customer_id: customerId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id }) =>
      formatResponse(await client.get(`/v1/customers/${customer_id}/members`))
  );

  server.registerTool(
    "team_remove_member",
    {
      title: "Remove a team member",
      description:
        "Remove a user's membership (role assignment) from this customer. HIGH IMPACT: the user immediately loses access and all their sessions are invalidated. You cannot remove yourself. Find the user UUID via team_list_members first. To change a member's permissions instead of removing them, use team_update_member_role. Requires the team:write scope.",
      inputSchema: { customer_id: customerId, user_id: userId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ customer_id, user_id }) =>
      formatResponse(
        await client.delete(
          `/v1/customers/${customer_id}/members/${user_id}`
        )
      )
  );

  server.registerTool(
    "team_update_member_role",
    {
      title: "Set a member's role",
      description:
        "Assign a role (system or customer-owned, never superadmin) to a member of this customer, replacing their current role. The caller must hold every scope the role grants (no privilege escalation). Find user UUIDs via team_list_members and role UUIDs via team_list_roles. Requires the team:write scope.",
      inputSchema: {
        customer_id: customerId,
        user_id: userId,
        role_id: z
          .string()
          .refine(isValidUuid, "Must be a UUID")
          .describe(
            "UUID of the role to assign (from team_list_roles); superadmin roles cannot be assigned"
          ),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ customer_id, user_id, role_id }) =>
      formatResponse(
        await client.put(
          `/v1/customers/${customer_id}/members/${user_id}/role`,
          { role_id }
        )
      )
  );

  server.registerTool(
    "team_list_roles",
    {
      title: "List roles",
      description:
        "List the system roles plus this customer's custom roles. Use to find a role UUID for team_update_member_role, team_get_role, team_update_role, team_duplicate_role, or team_delete_role. Requires the team:read scope.",
      inputSchema: { customer_id: customerId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id }) =>
      formatResponse(await client.get(`/v1/customers/${customer_id}/roles`))
  );

  server.registerTool(
    "team_get_role",
    {
      title: "Get a role",
      description:
        "Get one role (system or customer-owned) with its full scope list. Use to inspect exactly what a role grants before assigning it (team_update_member_role) or editing it (team_update_role). Requires the team:read scope.",
      inputSchema: { customer_id: customerId, role_id: roleId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id, role_id }) =>
      formatResponse(
        await client.get(`/v1/customers/${customer_id}/roles/${role_id}`)
      )
  );

  server.registerTool(
    "team_create_role",
    {
      title: "Create a custom role",
      description:
        "Create a customer-owned role with the given scope set. Scopes must exist in the platform registry (discover them with acct_list_scopes), be non-superadmin, and be held by the caller (no privilege escalation). To start from an existing role's scopes instead, use team_duplicate_role. Requires the team:write scope.",
      inputSchema: {
        customer_id: customerId,
        name: z
          .string()
          .describe(
            "Machine name for the role (unique within the customer), e.g. 'billing_viewer'"
          ),
        display_name: z
          .string()
          .describe("Human-readable role name, e.g. 'Billing Viewer'"),
        scopes: z
          .array(z.string())
          .describe(
            "Permission scopes the role grants, e.g. ['team:read', 'billing:read']. Use acct_list_scopes to see the full catalog."
          ),
        description: z
          .string()
          .optional()
          .describe("Optional free-text description of the role's purpose"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ customer_id, name, display_name, scopes, description }) =>
      formatResponse(
        await client.post(`/v1/customers/${customer_id}/roles`, {
          name,
          display_name,
          scopes,
          description,
        })
      )
  );

  server.registerTool(
    "team_update_role",
    {
      title: "Update a custom role",
      description:
        "Update the display name, description, and/or scope set of a customer-owned role. System roles are immutable. HIGH IMPACT when changing scopes: session invalidation fans out to every user holding the role. Only provided fields are changed. Use acct_list_scopes to discover valid scopes. Requires the team:write scope.",
      inputSchema: {
        customer_id: customerId,
        role_id: roleId,
        display_name: z
          .string()
          .optional()
          .describe("New human-readable role name"),
        description: z
          .string()
          .optional()
          .describe("New free-text description of the role's purpose"),
        scopes: z
          .array(z.string())
          .optional()
          .describe(
            "Replacement scope set, e.g. ['team:read', 'billing:read']. Replaces the role's entire scope list and invalidates sessions of affected users."
          ),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ customer_id, role_id, display_name, description, scopes }) =>
      formatResponse(
        await client.patch(
          `/v1/customers/${customer_id}/roles/${role_id}`,
          { display_name, description, scopes }
        )
      )
  );

  server.registerTool(
    "team_duplicate_role",
    {
      title: "Duplicate a role",
      description:
        "Create a new customer-owned role copying the source role's scope set (the source may be a system role). Useful for customizing a system role: duplicate it, then adjust scopes with team_update_role. The caller must hold every copied scope. Requires the team:write scope.",
      inputSchema: {
        customer_id: customerId,
        role_id: z
          .string()
          .refine(isValidUuid, "Must be a UUID")
          .describe(
            "Source role UUID to copy scopes from (find it via team_list_roles)"
          ),
        name: z
          .string()
          .describe(
            "Machine name for the new role (unique within the customer), e.g. 'support_admin_custom'"
          ),
        display_name: z
          .string()
          .describe("Human-readable name for the new role"),
        description: z
          .string()
          .optional()
          .describe("Optional free-text description of the new role"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ customer_id, role_id, name, display_name, description }) =>
      formatResponse(
        await client.post(
          `/v1/customers/${customer_id}/roles/${role_id}/duplicate`,
          { name, display_name, description }
        )
      )
  );

  server.registerTool(
    "team_delete_role",
    {
      title: "Delete a custom role",
      description:
        "Permanently delete a customer-owned role. HIGH IMPACT and irreversible. Fails when the role is still assigned to any user (reassign members via team_update_member_role first) or when it is a system role. Requires the team:write scope.",
      inputSchema: { customer_id: customerId, role_id: roleId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ customer_id, role_id }) =>
      formatResponse(
        await client.delete(`/v1/customers/${customer_id}/roles/${role_id}`)
      )
  );
}
