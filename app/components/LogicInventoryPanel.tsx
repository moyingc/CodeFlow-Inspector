import type { LogicInventoryItem } from "@/src/lib/analysis/types";

export function LogicInventoryPanel({ items }: { items: LogicInventoryItem[] }) {
  return (
    <div className="logic-grid">
      {items.map((item) => (
        <div className={`logic-card ${logicStatusClass(item.status)}`} key={item.category}>
          <div>
            <strong>{item.category}</strong>
            <span>{item.status}</span>
          </div>
          <p>{item.scope}</p>
          <small>{item.currentFunctions.join(" / ")}</small>
          <b>{item.nextModule}</b>
        </div>
      ))}
    </div>
  );
}

function logicStatusClass(status: LogicInventoryItem["status"]) {
  if (status === "已成型") return "logic-ready";
  if (status === "需替换") return "logic-replace";
  return "logic-extract";
}
