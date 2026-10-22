#!/usr/bin/env npx tsx
/**
 * Tenant Provisioning Script
 * 租戶資源配置自動化腳本
 *
 * Usage:
 *   npx tsx scripts/provision-tenant.ts --tenant-id <id>
 *
 * New tenants are created through onboarding (management portal "create
 * tenant", or POST /api/v1/admin/onboarding/applications), which also builds
 * the platform restaurant and owner account. This script only provisions and
 * deploys a tenant that already exists.
 */

import { parseArgs } from "util";

const MANAGEMENT_API_URL =
  process.env.MANAGEMENT_API_URL || "http://localhost:8790/api/v1";

async function provisionTenant(tenantId: string): Promise<boolean> {
  console.log(`\n⚙️  Provisioning resources for tenant: ${tenantId}`);

  try {
    const response = await fetch(
      `${MANAGEMENT_API_URL}/deployments/provision`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tenantId }),
      },
    );

    const result = await response.json();

    if (result.success && result.data) {
      console.log(`\n   ✅ Resources provisioned:`);
      result.data.forEach(
        (resource: {
          resourceType: string;
          resourceName: string;
          status: string;
        }) => {
          const emoji = resource.status === "provisioned" ? "✅" : "⏳";
          console.log(
            `      ${emoji} ${resource.resourceType}: ${resource.resourceName}`,
          );
        },
      );
      return true;
    } else {
      console.log(`   ❌ Provisioning failed: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error("Provisioning error:", error);
    return false;
  }
}

async function deployTenant(tenantId: string): Promise<boolean> {
  console.log(`\n🚀 Deploying tenant: ${tenantId}`);

  try {
    const response = await fetch(`${MANAGEMENT_API_URL}/deployments/deploy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tenantId }),
    });

    const result = await response.json();

    if (result.success && result.data) {
      console.log(`   ✅ Deployment started: ${result.data.id}`);
      console.log(`   📦 Version: ${result.data.toVersion}`);
      return true;
    } else {
      console.log(`   ❌ Deployment failed: ${result.error}`);
      return false;
    }
  } catch (error) {
    console.error("Deployment error:", error);
    return false;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      "tenant-id": { type: "string" },
      deploy: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`
🏗️  MakanMasak Tenant Provisioning Script

Usage:
  npx tsx scripts/provision-tenant.ts [options]

Options:
  --tenant-id <id>   Provision existing tenant
  --deploy           Also deploy after provisioning
  -h, --help         Show this help

Examples:
  # Provision existing tenant
  npx tsx scripts/provision-tenant.ts --tenant-id tenant-123
`);
    return;
  }

  const tenantId = values["tenant-id"];

  if (!tenantId) {
    console.error("❌ Error: Specify --tenant-id");
    process.exit(1);
  }

  // Provision resources
  const provisioned = await provisionTenant(tenantId);
  if (!provisioned) {
    process.exit(1);
  }

  // Deploy if requested
  if (values.deploy) {
    const deployed = await deployTenant(tenantId);
    if (!deployed) {
      process.exit(1);
    }
  }

  console.log("\n✨ Done!");
  console.log(`\n📋 Summary:`);
  console.log(`   Tenant ID: ${tenantId}`);
  console.log(`   Provisioned: ✅`);
  console.log(`   Deployed: ${values.deploy ? "✅" : "⏳ Pending"}`);
}

main().catch(console.error);
