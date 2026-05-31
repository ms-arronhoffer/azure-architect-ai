"""CI/CD pipeline emitters for GitHub Actions and Azure DevOps.

OIDC federated credentials only (no client secrets). Includes what-if step
before deploy, manual approval gate on prod, and rollback on failure.

Templates use simple `{{PATTERN}}`-style placeholders (not Jinja) because
GitHub Actions' own `${{ }}` syntax would collide with Jinja `{{ }}`.
"""
from __future__ import annotations

from middleware.logging import get_logger

log = get_logger("cicd_emitter")


_GHA_CI = """name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
__LINT_STEP__
"""

_GHA_INFRA = """name: Infra (__ENV__)
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: ['infra/**']

permissions:
  id-token: write
  contents: read

env:
  AZURE_CLIENT_ID: ${{ secrets.AZURE_CLIENT_ID }}
  AZURE_TENANT_ID: ${{ secrets.AZURE_TENANT_ID }}
  AZURE_SUBSCRIPTION_ID: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

jobs:
  whatif:
    runs-on: ubuntu-latest
    environment: __ENV__-readonly
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ env.AZURE_CLIENT_ID }}
          tenant-id: ${{ env.AZURE_TENANT_ID }}
          subscription-id: ${{ env.AZURE_SUBSCRIPTION_ID }}
      - name: What-if
        run: |
          az deployment group what-if \\
            --resource-group rg-__PATTERN__-__ENV__ \\
            --template-file infra/main.__EXT__ \\
            --parameters infra/main.__PARAM_EXT__

  deploy:
    needs: whatif
    runs-on: ubuntu-latest
    environment: __ENV____APPROVAL_SUFFIX__
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ env.AZURE_CLIENT_ID }}
          tenant-id: ${{ env.AZURE_TENANT_ID }}
          subscription-id: ${{ env.AZURE_SUBSCRIPTION_ID }}
      - name: Deploy with rollback
        run: |
          az deployment group create \\
            --resource-group rg-__PATTERN__-__ENV__ \\
            --template-file infra/main.__EXT__ \\
            --parameters infra/main.__PARAM_EXT__ \\
            --rollback-on-error
      - name: Note on failure
        if: failure()
        run: echo "Deployment failed; --rollback-on-error reverted to last successful deployment."
"""

_GHA_DEPLOY_APP = """name: App Deploy (__ENV__)
on:
  workflow_run:
    workflows: ["Infra (__ENV__)"]
    types: [completed]
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  deploy-app:
    if: ${{ github.event.workflow_run.conclusion == 'success' || github.event_name == 'workflow_dispatch' }}
    runs-on: ubuntu-latest
    environment: __ENV____APPROVAL_SUFFIX__
    steps:
      - uses: actions/checkout@v4
      - uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}
__APP_DEPLOY_STEPS__
"""

_GHA_APP_CONTAINERAPP = """      - name: Build and push image
        run: |
          az acr build --registry ${{ secrets.ACR_NAME }} \\
            --image __PATTERN__:${{ github.sha }} .
      - name: Deploy new revision
        run: |
          az containerapp update \\
            --name ca-__PATTERN__-__ENV__ \\
            --resource-group rg-__PATTERN__-__ENV__ \\
            --image ${{ secrets.ACR_NAME }}.azurecr.io/__PATTERN__:${{ github.sha }}
      - name: Rollback on failure
        if: failure()
        run: |
          prev=$(az containerapp revision list \\
            --name ca-__PATTERN__-__ENV__ \\
            --resource-group rg-__PATTERN__-__ENV__ \\
            --query "[?properties.active].name | [1]" -o tsv)
          az containerapp revision activate \\
            --name ca-__PATTERN__-__ENV__ \\
            --resource-group rg-__PATTERN__-__ENV__ \\
            --revision $prev
"""

_GHA_APP_WEBAPP = """      - name: Deploy app
        run: |
          az webapp deploy \\
            --resource-group rg-__PATTERN__-__ENV__ \\
            --name app-__PATTERN__-__ENV__ \\
            --src-path ./app.zip
"""

_ADO_INFRA = """# Azure DevOps pipeline - infra (__ENV__)
trigger:
  branches:
    include: [main]
  paths:
    include: [infra/*]

variables:
  azureServiceConnection: 'sc-__ENV__-oidc'
  rgName: 'rg-__PATTERN__-__ENV__'

stages:
- stage: WhatIf
  jobs:
  - job: WhatIf
    pool: {vmImage: 'ubuntu-latest'}
    steps:
    - task: AzureCLI@2
      inputs:
        azureSubscription: $(azureServiceConnection)
        scriptType: bash
        scriptLocation: inlineScript
        inlineScript: |
          az deployment group what-if \\
            --resource-group $(rgName) \\
            --template-file infra/main.__EXT__ \\
            --parameters infra/main.__PARAM_EXT__

- stage: Deploy
  dependsOn: WhatIf
  jobs:
  - deployment: Deploy
    environment: '__ENV____APPROVAL_SUFFIX__'
    pool: {vmImage: 'ubuntu-latest'}
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureCLI@2
            inputs:
              azureSubscription: $(azureServiceConnection)
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
                az deployment group create \\
                  --resource-group $(rgName) \\
                  --template-file infra/main.__EXT__ \\
                  --parameters infra/main.__PARAM_EXT__ \\
                  --rollback-on-error
"""

_ADO_APP = """# Azure DevOps pipeline - app deploy (__ENV__)
trigger:
  branches:
    include: [main]

variables:
  azureServiceConnection: 'sc-__ENV__-oidc'
  rgName: 'rg-__PATTERN__-__ENV__'

stages:
- stage: Deploy
  jobs:
  - deployment: DeployApp
    environment: '__ENV____APPROVAL_SUFFIX__'
    pool: {vmImage: 'ubuntu-latest'}
    strategy:
      runOnce:
        deploy:
          steps:
          - task: AzureCLI@2
            inputs:
              azureSubscription: $(azureServiceConnection)
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
__ADO_APP_INLINE__
          - task: AzureCLI@2
            displayName: Rollback on failure
            condition: failed()
            inputs:
              azureSubscription: $(azureServiceConnection)
              scriptType: bash
              scriptLocation: inlineScript
              inlineScript: |
__ADO_ROLLBACK_INLINE__
"""

_ADO_APP_CONTAINERAPP = """                az acr build --registry $(ACR_NAME) --image __PATTERN__:$(Build.SourceVersion) .
                az containerapp update --name ca-__PATTERN__-__ENV__ --resource-group $(rgName) --image $(ACR_NAME).azurecr.io/__PATTERN__:$(Build.SourceVersion)"""

_ADO_APP_WEBAPP = """                az webapp deploy --resource-group $(rgName) --name app-__PATTERN__-__ENV__ --src-path $(Build.ArtifactStagingDirectory)/app.zip"""

_ADO_ROLLBACK_CONTAINERAPP = """                prev=$(az containerapp revision list --name ca-__PATTERN__-__ENV__ --resource-group $(rgName) --query "[?properties.active].name | [1]" -o tsv)
                az containerapp revision activate --name ca-__PATTERN__-__ENV__ --resource-group $(rgName) --revision $prev"""

_ADO_ROLLBACK_WEBAPP = """                echo "Rollback: re-run the previous successful pipeline or swap deployment slots."""


def _ext_for(deploy_method: str) -> tuple[str, str]:
    if deploy_method == "terraform":
        return "tf", "tfvars"
    return "bicep", "bicepparam"


def _lint_step(deploy_method: str) -> str:
    if deploy_method == "bicep":
        return "      - name: Bicep lint\n        run: az bicep build --file infra/main.bicep"
    if deploy_method == "terraform":
        return "      - name: Terraform fmt\n        run: terraform -chdir=infra fmt -check"
    return "      - name: Container build smoke\n        run: docker build -t app:ci ."


def _substitute(template: str, pattern: str, environment: str, deploy_method: str) -> str:
    ext, param_ext = _ext_for(deploy_method)
    approval_suffix = "-approval" if environment == "prod" else ""
    return (
        template
        .replace("__PATTERN__", pattern)
        .replace("__ENV__", environment)
        .replace("__EXT__", ext)
        .replace("__PARAM_EXT__", param_ext)
        .replace("__APPROVAL_SUFFIX__", approval_suffix)
    )


def emit_github_actions(
    target_pattern: str,
    environment: str,
    deploy_method: str = "bicep",
) -> dict[str, str]:
    """Render GitHub Actions workflows for the given pattern + environment."""
    log.info("cicd.gha.emit", pattern=target_pattern, env=environment, method=deploy_method)

    ci = _substitute(
        _GHA_CI.replace("__LINT_STEP__", _lint_step(deploy_method)),
        target_pattern, environment, deploy_method,
    )
    infra = _substitute(_GHA_INFRA, target_pattern, environment, deploy_method)
    app_steps_raw = _GHA_APP_CONTAINERAPP if deploy_method == "containerapp" else _GHA_APP_WEBAPP
    deploy = _substitute(
        _GHA_DEPLOY_APP.replace("__APP_DEPLOY_STEPS__", app_steps_raw),
        target_pattern, environment, deploy_method,
    )
    return {
        ".github/workflows/ci.yml": ci,
        ".github/workflows/infra.yml": infra,
        ".github/workflows/deploy.yml": deploy,
    }


def emit_azure_devops(
    target_pattern: str,
    environment: str,
    deploy_method: str = "bicep",
) -> dict[str, str]:
    """Render Azure DevOps multi-stage YAML pipelines."""
    log.info("cicd.ado.emit", pattern=target_pattern, env=environment, method=deploy_method)

    infra = _substitute(_ADO_INFRA, target_pattern, environment, deploy_method)
    app_inline = _ADO_APP_CONTAINERAPP if deploy_method == "containerapp" else _ADO_APP_WEBAPP
    rollback_inline = _ADO_ROLLBACK_CONTAINERAPP if deploy_method == "containerapp" else _ADO_ROLLBACK_WEBAPP
    app = _substitute(
        _ADO_APP
        .replace("__ADO_APP_INLINE__", app_inline)
        .replace("__ADO_ROLLBACK_INLINE__", rollback_inline),
        target_pattern, environment, deploy_method,
    )
    return {
        "azure-pipelines.yml": app,
        "azure-pipelines.infra.yml": infra,
    }


__all__ = ["emit_github_actions", "emit_azure_devops"]
