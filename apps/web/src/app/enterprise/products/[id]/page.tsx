"use client";
import { useParams } from "next/navigation";
import { ProductDetail } from "@/components/workspace/product-detail";
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <ProductDetail id={id} />;
}
