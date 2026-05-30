export interface ServiceMeta {
  category: string;
  sla: string;
  pricingUrl: string;
  docsUrl: string;
}

export const SERVICE_CATALOG: Record<string, ServiceMeta> = {
  "azure app service": { category: "Compute", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/app-service/windows/", docsUrl: "https://learn.microsoft.com/azure/app-service/" },
  "app service": { category: "Compute", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/app-service/windows/", docsUrl: "https://learn.microsoft.com/azure/app-service/" },
  "azure kubernetes service": { category: "Containers", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/kubernetes-service/", docsUrl: "https://learn.microsoft.com/azure/aks/" },
  "aks": { category: "Containers", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/kubernetes-service/", docsUrl: "https://learn.microsoft.com/azure/aks/" },
  "azure functions": { category: "Compute", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/functions/", docsUrl: "https://learn.microsoft.com/azure/azure-functions/" },
  "azure container apps": { category: "Containers", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/container-apps/", docsUrl: "https://learn.microsoft.com/azure/container-apps/" },
  "container apps": { category: "Containers", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/container-apps/", docsUrl: "https://learn.microsoft.com/azure/container-apps/" },
  "azure sql database": { category: "Data", sla: "99.99%", pricingUrl: "https://azure.microsoft.com/pricing/details/azure-sql-database/single/", docsUrl: "https://learn.microsoft.com/azure/azure-sql/database/" },
  "sql database": { category: "Data", sla: "99.99%", pricingUrl: "https://azure.microsoft.com/pricing/details/azure-sql-database/single/", docsUrl: "https://learn.microsoft.com/azure/azure-sql/database/" },
  "cosmos db": { category: "Data", sla: "99.999%", pricingUrl: "https://azure.microsoft.com/pricing/details/cosmos-db/autoscale-provisioned/", docsUrl: "https://learn.microsoft.com/azure/cosmos-db/" },
  "azure cosmos db": { category: "Data", sla: "99.999%", pricingUrl: "https://azure.microsoft.com/pricing/details/cosmos-db/autoscale-provisioned/", docsUrl: "https://learn.microsoft.com/azure/cosmos-db/" },
  "azure storage": { category: "Storage", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/storage/blobs/", docsUrl: "https://learn.microsoft.com/azure/storage/" },
  "azure blob storage": { category: "Storage", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/storage/blobs/", docsUrl: "https://learn.microsoft.com/azure/storage/blobs/" },
  "azure key vault": { category: "Security", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/key-vault/", docsUrl: "https://learn.microsoft.com/azure/key-vault/" },
  "key vault": { category: "Security", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/key-vault/", docsUrl: "https://learn.microsoft.com/azure/key-vault/" },
  "azure service bus": { category: "Messaging", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/service-bus/", docsUrl: "https://learn.microsoft.com/azure/service-bus-messaging/" },
  "service bus": { category: "Messaging", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/service-bus/", docsUrl: "https://learn.microsoft.com/azure/service-bus-messaging/" },
  "azure event hubs": { category: "Messaging", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/event-hubs/", docsUrl: "https://learn.microsoft.com/azure/event-hubs/" },
  "event hubs": { category: "Messaging", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/event-hubs/", docsUrl: "https://learn.microsoft.com/azure/event-hubs/" },
  "azure event grid": { category: "Messaging", sla: "99.99%", pricingUrl: "https://azure.microsoft.com/pricing/details/event-grid/", docsUrl: "https://learn.microsoft.com/azure/event-grid/" },
  "event grid": { category: "Messaging", sla: "99.99%", pricingUrl: "https://azure.microsoft.com/pricing/details/event-grid/", docsUrl: "https://learn.microsoft.com/azure/event-grid/" },
  "application gateway": { category: "Networking", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/application-gateway/", docsUrl: "https://learn.microsoft.com/azure/application-gateway/" },
  "azure application gateway": { category: "Networking", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/application-gateway/", docsUrl: "https://learn.microsoft.com/azure/application-gateway/" },
  "azure front door": { category: "Networking", sla: "99.99%", pricingUrl: "https://azure.microsoft.com/pricing/details/frontdoor/", docsUrl: "https://learn.microsoft.com/azure/frontdoor/" },
  "front door": { category: "Networking", sla: "99.99%", pricingUrl: "https://azure.microsoft.com/pricing/details/frontdoor/", docsUrl: "https://learn.microsoft.com/azure/frontdoor/" },
  "api management": { category: "Integration", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/api-management/", docsUrl: "https://learn.microsoft.com/azure/api-management/" },
  "azure api management": { category: "Integration", sla: "99.95%", pricingUrl: "https://azure.microsoft.com/pricing/details/api-management/", docsUrl: "https://learn.microsoft.com/azure/api-management/" },
  "azure monitor": { category: "Monitoring", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/monitor/", docsUrl: "https://learn.microsoft.com/azure/azure-monitor/" },
  "log analytics": { category: "Monitoring", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/monitor/", docsUrl: "https://learn.microsoft.com/azure/azure-monitor/logs/" },
  "application insights": { category: "Monitoring", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/monitor/", docsUrl: "https://learn.microsoft.com/azure/azure-monitor/app/app-insights-overview" },
  "azure cache for redis": { category: "Data", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/cache/", docsUrl: "https://learn.microsoft.com/azure/azure-cache-for-redis/" },
  "redis": { category: "Data", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/cache/", docsUrl: "https://learn.microsoft.com/azure/azure-cache-for-redis/" },
  "virtual network": { category: "Networking", sla: "N/A", pricingUrl: "https://azure.microsoft.com/pricing/details/virtual-network/", docsUrl: "https://learn.microsoft.com/azure/virtual-network/" },
  "container registry": { category: "Containers", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/container-registry/", docsUrl: "https://learn.microsoft.com/azure/container-registry/" },
  "azure container registry": { category: "Containers", sla: "99.9%", pricingUrl: "https://azure.microsoft.com/pricing/details/container-registry/", docsUrl: "https://learn.microsoft.com/azure/container-registry/" },
};

export function lookupService(label: string): ServiceMeta | null {
  const lower = label.toLowerCase();
  if (SERVICE_CATALOG[lower]) return SERVICE_CATALOG[lower];
  for (const [key, val] of Object.entries(SERVICE_CATALOG)) {
    if (lower.includes(key) || key.includes(lower)) return val;
  }
  return null;
}
