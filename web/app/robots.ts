import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://razeqa.dev";

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/register", "/design-system"],
        disallow: ["/dashboard/", "/api/"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
