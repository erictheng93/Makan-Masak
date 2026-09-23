import type { Messages } from "../types";

const enUS: Messages = {
  common: {
    appName: "MakanMasak",
    loading: "Loading...",
    view: "View",
    viewAll: "View All",
    viewDetails: "View Details",
    manage: "Manage",
    actions: "Actions",
    cancel: "Cancel",
    generate: "Generate",
    selectAll: "Select All",
    pleaseSelect: "Please Select",
    unknown: "Unknown",
    processing: "Processing...",
  },

  nav: {
    dashboard: "Overview",
    tenants: "Tenants",
    deployments: "Deployments",
    health: "Health",
    licenses: "Licenses",
    markets: "Markets",
    policies: "Region policies",
  },

  layout: {
    managementPortal: "Management Portal",
    version: "Version {version}",
  },

  dashboard: {
    title: "Overview",
    subtitle: "Management platform status overview",
    stats: {
      totalTenants: "Total Tenants",
      active: "Active",
      pending: "Pending",
      unhealthy: "Unhealthy",
    },
    health: {
      title: "Health Status",
      healthyRunning: "Healthy",
    },
    pending: {
      title: "Pending Items",
      empty: "No pending items",
      waitingProvision: "Waiting for provisioning",
      handle: "Handle",
      serviceDown: "Service Down",
      serviceDegraded: "Service Degraded",
    },
    recentTenants: {
      title: "Recent Tenants",
    },
  },

  tenants: {
    title: "Tenant Management",
    subtitle: "Manage all self-hosted restaurant tenants",
    create: "Create Tenant",
    empty: {
      none: "No tenants",
      noResults: "No matching tenants",
      tryAdjust: "Try adjusting your search",
      createFirst: "Click Create to add your first tenant",
    },
    filter: {
      searchPlaceholder: "Search by name, email, subdomain...",
      allStatuses: "All Statuses",
    },
    column: {
      businessName: "Business Name",
      contactEmail: "Contact Email",
      subdomain: "Subdomain",
      status: "Status",
      version: "Version",
      deployedVersion: "Deployed Version",
      createdAt: "Created At",
    },
    status: {
      active: "Active",
      pending: "Pending",
      provisioning: "Provisioning",
      suspended: "Suspended",
      terminated: "Terminated",
    },
    toast: {
      createSuccess: "Tenant created successfully",
    },
    createModal: {
      title: "Create Tenant",
      field: {
        businessName: "Business Name",
        businessNamePlaceholder: "e.g. Royal Kitchen",
        contactEmail: "Contact Email",
        contactEmailPlaceholder: "owner@restaurant.com",
        contactPhone: "Phone",
        contactPhonePlaceholder: "+1-234-567-8900",
        subdomain: "Subdomain",
        subdomainPlaceholder: "royalkitchen",
        subdomainSuffix: ".makanmasak.com",
        subdomainHint: "Leave blank to auto-generate",
        selectPlan: "Select Plan",
      },
      plan: {
        standard: {
          label: "Standard - $149/mo",
          description: "1 restaurant, basic features",
        },
        professional: {
          label: "Professional - $299/mo",
          description: "3 restaurants, full features",
        },
        enterprise: {
          label: "Enterprise - Custom",
          description: "Unlimited restaurants, custom support",
        },
      },
      validation: {
        businessNameRequired: "Please enter a business name",
        emailRequired: "Please enter a contact email",
        emailInvalid: "Please enter a valid email",
        subdomainFormat:
          "Subdomain can only contain lowercase letters, numbers, and hyphens",
      },
      error: {
        createFailed: "Failed to create tenant. Please try again later.",
      },
      creating: "Creating...",
      submit: "Create Tenant",
    },
  },

  tenantDetail: {
    backToList: "Back to Tenants",
    provisioning: "Provisioning...",
    provisionResources: "Provision Resources",
    deploying: "Deploying...",
    redeploy: "Redeploy",
    tabs: {
      overview: "Overview",
      resources: "Resources",
      deployments: "Deployments",
      health: "Health",
      license: "License",
    },
    toast: {
      loadFailed: "Failed to load tenant",
      provisionSuccess: "Resources provisioned successfully",
      provisionFailed: "Resource provisioning failed",
      deployStarted: "Deployment started",
      deployFailed: "Deployment failed",
    },
    resource: {
      type: {
        d1: "D1 Database",
        kv: "KV Storage",
        r2: "R2 Object Storage",
        worker: "Worker",
        pages: "Pages",
      },
    },
    basicInfo: {
      title: "Basic Information",
      businessName: "Business Name",
      contactEmail: "Contact Email",
      contactPhone: "Phone",
      subdomain: "Subdomain",
      customDomain: "Custom Domain",
      createdAt: "Created At",
    },
    deployInfo: {
      title: "Deployment Info",
      currentVersion: "Current Version",
      notDeployed: "Not deployed",
      connected: "Connected",
      notConnected: "Not connected",
      resourceCount: "Resource Count",
      itemSuffix: "",
      lastDeploy: "Last Deploy",
    },
    resources: {
      title: "Cloudflare Resources",
      empty: "No resources provisioned",
      column: {
        type: "Type",
        name: "Name",
        id: "ID",
        status: "Status",
        createdAt: "Created At",
      },
      status: {
        provisioned: "Provisioned",
        pending: "Pending",
        failed: "Failed",
      },
    },
    deployments: {
      title: "Deployment History",
      empty: "No deployment records",
      type: {
        initial: "Initial Deploy",
        update: "Version Update",
        rollback: "Rollback",
      },
    },
    health: {
      title: "Health Status",
      empty: "No health check records",
    },
    license: {
      title: "License Information",
      empty: "No license records",
    },
  },

  licenses: {
    title: "License Management",
    subtitle: "Manage tenant license keys",
    generate: "Generate License",
    empty: "No license records",
    valid: "Valid",
    revoked: "Revoked",
    permanent: "Permanent",
    permanentValid: "Permanent",
    validUntil: "Valid Until",
    upgrade: "Upgrade",
    stats: {
      active: "Active Licenses",
    },
    tier: {
      standard: "Standard",
      professional: "Professional",
      enterprise: "Enterprise",
    },
    column: {
      tenant: "Tenant",
      licenseKey: "License Key",
      tier: "Tier",
      status: "Status",
      validity: "Validity",
      createdAt: "Created At",
    },
    validation: {
      selectTenant: "Please select a tenant",
    },
    toast: {
      generateSuccess: "License generated successfully",
      generateFailed: "Failed to generate license",
    },
    modal: {
      title: "Generate License",
      selectTenant: "Select Tenant",
      tier: "License Tier",
      tierOption: {
        standard: "Standard - $149/mo",
        professional: "Professional - $299/mo",
        enterprise: "Enterprise - Custom",
      },
      expiresAt: "Expires At (Optional)",
      expiresAtHint: "Leave blank for permanent license",
    },
  },

  deployments: {
    title: "Deployment Management",
    subtitle: "Batch deployment and version updates",
    batch: {
      title: "Batch Deploy",
      targetVersion: "Target Version",
      versionPlaceholder: "e.g. 1.2.0",
      deploying: "Deploying...",
      deployWithCount: "Deploy ({count})",
      selectTenants: "Select Tenants",
      currentVersionLabel: "Current version:",
      notDeployed: "Not deployed",
    },
    status: {
      pending: "Pending",
      inProgress: "In Progress",
      completed: "Completed",
      failed: "Failed",
      rolledBack: "Rolled Back",
    },
    validation: {
      selectTenant: "Please select at least one tenant",
      enterVersion: "Please enter a target version",
    },
    toast: {
      queuedCount: "Queued {count} deployment tasks",
      failedCount: "{count} tenant deployments failed",
      batchFailed: "Batch deployment failed",
    },
    recent: {
      title: "Recent Deployments",
      empty: "No deployment records",
    },
  },

  health: {
    title: "Health Monitoring",
    subtitle: "Monitor runtime status across all tenants",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    overall: "Overall Status",
    avgResponseTime: "Avg Response Time",
    lastUpdated: "Last updated:",
    status: {
      healthy: "Healthy",
      degraded: "Degraded",
      down: "Down",
    },
    attention: {
      title: "Needs Attention",
      serviceDown: "Service Down",
      serviceDegraded: "Service Degraded",
    },
    all: {
      title: "All Tenants",
      empty: "No health check data",
    },
    column: {
      tenant: "Tenant",
      status: "Status",
      responseTime: "Response Time",
      api: "API",
      database: "Database",
      cache: "Cache",
      storage: "Storage",
      checkedAt: "Checked At",
    },
  },

  policies: {
    title: "Region policies",
    subtitle:
      "Set modules, payments, plans and fees per country or market. Unset items inherit from the level above.",
    countries: { TW: "Taiwan", MY: "Malaysia" },
    scope: { market: "Market", marketPlaceholder: "Choose a market…" },
    unknownCountryWarning:
      "{count} shops have no country yet, so country policies do not apply to them. Run the country backfill first.",
    confirmUnknownCountry:
      "{count} shops have no country and will not follow this policy. Save anyway?",
    inherited: "Not set — inherits from the level above",
    merge: {
      ceiling_deny: "Ceiling: off if any level turns it off",
      ceiling_allow: "Ceiling: only listed items are allowed",
      default: "Default: shops can override",
      platform_cap: "Platform only: shops cannot change",
    },
    keys: {
      modules_disabled: "Disabled modules",
      payments_allowed_providers: "Allowed online payment providers",
      pricing_default_tax_rate_bps: "Default tax rate",
      pricing_default_service_charge_rate_bps: "Default service charge rate",
      plans_allowed_tiers: "Paid plans on sale",
      platform_max_fee_rate_bps: "Market platform fee cap",
    },
    actions: { save: "Save", clear: "Clear" },
    toast: { saved: "Policy saved", cleared: "Policy cleared" },
  },

  notFound: {
    title: "Page Not Found",
    description:
      "The page you visited may have been removed or is temporarily unavailable",
    backHome: "Back to Home",
  },
};

export default enUS;
