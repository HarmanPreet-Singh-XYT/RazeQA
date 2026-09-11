# Manual Deployment Workflows

The deployment workflow in [deploy.yml](file:///Users/harmanpreetsingh/Public/Code/CodeTest/.github/workflows/deploy.yml) is configured **strictly for manual execution** (`workflow_dispatch`). It will **never** trigger automatically on `push` or `pull_request`.

---

## How to Run Manually in GitHub

1. Navigate to your repository on GitHub.
2. Click on the **Actions** tab.
3. In the left sidebar, select **Manual Deployment**.
4. Click the **Run workflow** dropdown on the right:
   * **Component to deploy**: Select `all`, `agent`, or `web`.
   * **Target Environment**: Select `production` or `staging`.
   * **AWS Compute Target**:
     * `ecs`: Builds and updates your AWS ECS Fargate cluster services.
     * `agentcore`: Builds the `linux/arm64` container image for Amazon Bedrock AgentCore.
     * `apprunner`: Triggers AWS App Runner service deployments.
     * `ecr_only`: Only builds and pushes images to Amazon ECR without updating running tasks.
   * **AWS Region**: e.g., `us-east-1`.
5. Click **Run workflow**.

---

## GitHub Secrets Configuration

Configure these in your GitHub repository under **Settings > Secrets and variables > Actions**:

| Secret Name | Required? | Description |
| :--- | :---: | :--- |
| **`AWS_ROLE_TO_ASSUME`** | Recommended | IAM Role ARN for GitHub Actions OIDC federation (no static keys needed). |
| **`AWS_ACCESS_KEY_ID`** | Alternative | AWS Access Key ID (if not using OIDC). |
| **`AWS_SECRET_ACCESS_KEY`** | Alternative | AWS Secret Access Key (if not using OIDC). |
| **`ECR_AGENT_REPO`** | Optional | ECR repository name for Agent (defaults to `pr-testing-agent`). |
| **`ECR_WEB_REPO`** | Optional | ECR repository name for Web dashboard (defaults to `pr-testing-web`). |
| **`ECS_CLUSTER`** | Optional | ECS Cluster name (required if `deploy_target` is `ecs`). |
| **`ECS_AGENT_SERVICE`** | Optional | ECS Service name for agent (defaults to `pr-agent-service`). |
| **`ECS_WEB_SERVICE`** | Optional | ECS Service name for web dashboard (defaults to `pr-web-service`). |
| **`APPRUNNER_AGENT_ARN`** | Optional | AWS App Runner Service ARN (required if `deploy_target` is `apprunner`). |
| **`APPRUNNER_WEB_ARN`** | Optional | AWS App Runner Service ARN (required if `deploy_target` is `apprunner`). |
| **`NEXT_PUBLIC_SUPABASE_URL`** | Recommended | Supabase URL injected into the Next.js client bundle during web build. |
| **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** | Recommended | Supabase Anon Key injected into the Next.js client bundle during web build. |
