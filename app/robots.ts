import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://nomadastours.com.ve";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/admin/", "/agency/", "/api/", "/reservations/link/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
