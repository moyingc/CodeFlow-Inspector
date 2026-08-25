import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import { ProductPresentationBoundary } from "@/app/components/ProductPresentationBoundary";
import "@/app/globals.css";

const locale = import.meta.env.VITE_CODEFLOW_LOCALE === "en-US" ? "en-US" : "zh-CN";
document.documentElement.lang = locale;
document.title = locale === "en-US" ? "CodeFlow Inspector" : "CodeFlow Inspector 中文版";

const root = document.getElementById("root");
if (!root) throw new Error("CodeFlow desktop root element is missing");

createRoot(root).render(
  <ProductPresentationBoundary locale={locale}>
    <Home />
  </ProductPresentationBoundary>,
);
