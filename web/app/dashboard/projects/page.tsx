import ProjectsClient from "./projects-client";

export const metadata = {
  title: "Projects & Settings — AutoQA",
  description: "Configure GitHub App onboarding, multi-role test credentials, and automated testing policies.",
};

export default function ProjectsPage() {
  return <ProjectsClient />;
}
