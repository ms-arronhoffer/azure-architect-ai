FROM python:3.11-slim

# Node.js for @azure/mcp stdio subprocess.
# libicu-dev pulls the matching libicuXX runtime for the base image (Debian
# trixie ships libicu76, bookworm shipped libicu72). The .NET-based
# @azure/mcp binary requires it; without ICU it crashes on startup with
# "Couldn't find a valid ICU package".
RUN apt-get update && apt-get install -y curl libicu-dev && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-install azure-mcp so startup doesn't wait for npx download
RUN npm install -g @azure/mcp@latest

# Azure CLI — needed when authenticating to Azure OpenAI via a user identity
# (`az login` on the host + bind-mount of ~/.azure). DefaultAzureCredential's
# AzureCliCredential shells out to `az`, so the binary must be on PATH.
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-install Bicep CLI so bicep_service.build_and_preview avoids first-call download.
RUN az bicep install

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright Chromium for PDF generation (report_analyzer_service)
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
