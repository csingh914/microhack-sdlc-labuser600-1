# Challenge 5 - Deploy into Azure

**[Home](../Readme.md)** - [Previous Challenge](challenge-04.md) - [Next Challenge](challenge-06.md)

## Goal

Deploy the full Octocat Supply application to **Microsoft Azure** using **Infrastructure as Code (IaC)** and a **GitHub Actions** CI/CD pipeline. The deployment should be automated, repeatable, defined as code, and driven from GitHub Actions.

## Actions

* **Choose your IaC** — Define the Azure infrastructure using an IaC approach (e.g. **Bicep** or **Terraform**) for the resources the app needs: compute for frontend/API, storage/database, and supporting services.
* **Author the templates** — Use Copilot to help generate and refine the IaC, following Azure best practices.
* **Build the pipeline** — Create a GitHub Actions workflow that builds, tests, provisions infrastructure, and deploys the frontend and API.
* **Configure securely** — Use GitHub secrets / **OIDC federated credentials** for Azure authentication; avoid hard-coded credentials.
* **Deploy and verify** — Run the pipeline and confirm the application is reachable in Azure.

> **Included deployment path.** [`infra/`](../infra/README.md) (Bicep) and [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) configure a demo deployment using Container Apps, ACR, Log Analytics, and OIDC. The API is private behind the frontend proxy; SQLite and in-memory cart state are ephemeral and the apps are capped at one replica. Review the cost and persistence tradeoffs, configure OIDC, and verify the deployment for your subscription before running it. See [`infra/README.md`](../infra/README.md).

## Success criteria

* Azure infrastructure is defined as code and provisions cleanly (no manual portal clicking to create resources).
* A single GitHub Actions workflow builds, tests, provisions, and deploys the application.
* Authentication to Azure uses secrets/OIDC — no credentials in source.
* The deployed application is reachable and functional in Azure (exercise a real flow, e.g. the cart).

## Learning resources

* [Deploy to Azure from GitHub Actions](https://learn.microsoft.com/en-us/azure/developer/github/github-actions)
* [Authenticate to Azure from GitHub Actions using OIDC](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect)
* [Bicep documentation](https://learn.microsoft.com/en-us/azure/azure-resource-manager/bicep/)
* [Azure Container Apps](https://learn.microsoft.com/en-us/azure/container-apps/)
* [Azure Well-Architected Framework](https://learn.microsoft.com/en-us/azure/well-architected/)
