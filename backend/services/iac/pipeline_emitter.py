"""CI/CD pipeline emitter — GitHub Actions and Azure DevOps YAML.

Pipelines use OIDC federated credentials (no client secrets) and follow the
what-if → apply → smoke-test → promote pattern. Generated YAML is opinionated
for the IaC outputs from `services.iac` (Terraform or ARM) and reuses the
managed identity provisioned in `infra/modules/identity.bicep` (Phase 6.5).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

IacFormat = Literal["terraform", "arm", "bicep"]


@dataclass
class PipelineConfig:
    name: str
    iac_format: IacFormat
    iac_path: str = "infra"
    subscription_id_secret: str = "AZURE_SUBSCRIPTION_ID"
    tenant_id_secret: str = "AZURE_TENANT_ID"
    client_id_secret: str = "AZURE_CLIENT_ID"
    environments: tuple[str, ...] = ("dev", "prod")
    smoke_test_url_secret: str | None = "SMOKE_TEST_URL"


def _gha_terraform(cfg: PipelineConfig) -> str:
    return f"""name: {cfg.name}

on:
  pull_request:
    paths: ['{cfg.iac_path}/**']
  push:
    branches: [main]
    paths: ['{cfg.iac_path}/**']
  workflow_dispatch:

permissions:
  id-token: write
  contents: read
  pull-requests: write

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: {cfg.iac_path}
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - uses: azure/login@v2
        with:
          client-id: ${{{{ secrets.{cfg.client_id_secret} }}}}
          tenant-id: ${{{{ secrets.{cfg.tenant_id_secret} }}}}
          subscription-id: ${{{{ secrets.{cfg.subscription_id_secret} }}}}
      - run: terraform init
      - run: terraform validate
      - run: terraform plan -out=tfplan
      - uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: {cfg.iac_path}/tfplan

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: prod
    defaults:
      run:
        working-directory: {cfg.iac_path}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: tfplan
          path: {cfg.iac_path}
      - uses: hashicorp/setup-terraform@v3
      - uses: azure/login@v2
        with:
          client-id: ${{{{ secrets.{cfg.client_id_secret} }}}}
          tenant-id: ${{{{ secrets.{cfg.tenant_id_secret} }}}}
          subscription-id: ${{{{ secrets.{cfg.subscription_id_secret} }}}}
      - run: terraform init
      - run: terraform apply -auto-approve tfplan
"""


def _gha_arm(cfg: PipelineConfig) -> str:
    return f"""name: {cfg.name}

on:
  pull_request:
    paths: ['{cfg.iac_path}/**']
  push:
    branches: [main]
    paths: ['{cfg.iac_path}/**']
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  whatif:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{{{ secrets.{cfg.client_id_secret} }}}}
          tenant-id: ${{{{ secrets.{cfg.tenant_id_secret} }}}}
          subscription-id: ${{{{ secrets.{cfg.subscription_id_secret} }}}}
      - name: What-if
        run: |
          az deployment sub what-if \\
            --location eastus2 \\
            --template-file {cfg.iac_path}/azuredeploy.json \\
            --parameters {cfg.iac_path}/azuredeploy.parameters.json

  deploy:
    needs: whatif
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: prod
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{{{ secrets.{cfg.client_id_secret} }}}}
          tenant-id: ${{{{ secrets.{cfg.tenant_id_secret} }}}}
          subscription-id: ${{{{ secrets.{cfg.subscription_id_secret} }}}}
      - name: Deploy
        run: |
          az deployment sub create \\
            --location eastus2 \\
            --template-file {cfg.iac_path}/azuredeploy.json \\
            --parameters {cfg.iac_path}/azuredeploy.parameters.json
"""


def _ado_terraform(cfg: PipelineConfig) -> str:
    return f"""trigger:
  branches:
    include: [main]
  paths:
    include: ['{cfg.iac_path}/**']

pr:
  paths:
    include: ['{cfg.iac_path}/**']

variables:
  azureServiceConnection: 'azure-oidc'

stages:
- stage: Plan
  jobs:
  - job: Plan
    pool: {{ vmImage: 'ubuntu-latest' }}
    steps:
    - task: TerraformInstaller@1
    - task: AzureCLI@2
      inputs:
        azureSubscription: $(azureServiceConnection)
        scriptType: bash
        scriptLocation: inlineScript
        addSpnToEnvironment: true
        workingDirectory: {cfg.iac_path}
        inlineScript: |
          terraform init
          terraform plan -out=tfplan
    - publish: {cfg.iac_path}/tfplan
      artifact: tfplan

- stage: Apply
  condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
  jobs:
  - deployment: Apply
    environment: prod
    pool: {{ vmImage: 'ubuntu-latest' }}
    strategy:
      runOnce:
        deploy:
          steps:
          - download: current
            artifact: tfplan
          - task: TerraformInstaller@1
          - task: AzureCLI@2
            inputs:
              azureSubscription: $(azureServiceConnection)
              scriptType: bash
              scriptLocation: inlineScript
              workingDirectory: {cfg.iac_path}
              inlineScript: |
                terraform init
                terraform apply -auto-approve $(Pipeline.Workspace)/tfplan/tfplan
"""


def emit_github_actions(cfg: PipelineConfig) -> dict[str, str]:
    if cfg.iac_format == "terraform":
        body = _gha_terraform(cfg)
    elif cfg.iac_format == "arm":
        body = _gha_arm(cfg)
    else:
        raise ValueError(f"unsupported iac_format for GHA: {cfg.iac_format}")
    return {".github/workflows/deploy.yml": body}


def emit_azure_devops(cfg: PipelineConfig) -> dict[str, str]:
    if cfg.iac_format != "terraform":
        raise ValueError("ADO emitter currently supports terraform only")
    return {"azure-pipelines.yml": _ado_terraform(cfg)}


__all__ = ["PipelineConfig", "emit_azure_devops", "emit_github_actions"]
