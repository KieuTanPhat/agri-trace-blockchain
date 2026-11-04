import { NewsArticle } from "@/features/ledger/public/news";

export default async function NewsArticlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewsArticle id={id} />;
}
