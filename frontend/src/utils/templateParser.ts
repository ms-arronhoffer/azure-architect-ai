export function parseArmTemplate(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    const resources: unknown[] = parsed.resources ?? [];
    return [...new Set(resources.map((r: unknown) => (r as { type?: string }).type).filter(Boolean) as string[])];
  } catch {
    return [];
  }
}

export function parseBicepText(bicep: string): string[] {
  const matches = [...bicep.matchAll(/resource\s+\w+\s+'([^']+)'/g)];
  const types = matches.map((m) => {
    const full = m[1];
    const atIdx = full.indexOf("@");
    return atIdx >= 0 ? full.slice(0, atIdx) : full;
  });
  return [...new Set(types)];
}

const RESOURCE_FRIENDLY: Record<string, string> = {
  "Microsoft.Web/sites": "Azure App Service",
  "Microsoft.Web/serverFarms": "App Service Plan",
  "Microsoft.Sql/servers": "Azure SQL Server",
  "Microsoft.Sql/servers/databases": "Azure SQL Database",
  "Microsoft.Storage/storageAccounts": "Azure Storage",
  "Microsoft.KeyVault/vaults": "Azure Key Vault",
  "Microsoft.ContainerService/managedClusters": "AKS",
  "Microsoft.DocumentDB/databaseAccounts": "Cosmos DB",
  "Microsoft.ServiceBus/namespaces": "Service Bus",
  "Microsoft.EventHub/namespaces": "Event Hubs",
  "Microsoft.Network/virtualNetworks": "Virtual Network",
  "Microsoft.Network/applicationGateways": "Application Gateway",
  "Microsoft.Network/frontDoors": "Azure Front Door",
  "Microsoft.Cache/Redis": "Azure Cache for Redis",
  "Microsoft.Insights/components": "Application Insights",
  "Microsoft.OperationalInsights/workspaces": "Log Analytics",
  "Microsoft.CognitiveServices/accounts": "Azure AI Services",
  "Microsoft.MachineLearningServices/workspaces": "Azure ML",
  "Microsoft.ContainerRegistry/registries": "Container Registry",
  "Microsoft.ApiManagement/service": "API Management",
};

export function formatResourceList(types: string[]): string {
  return types.map((t) => RESOURCE_FRIENDLY[t] ?? t.split("/").pop() ?? t).join(", ");
}
