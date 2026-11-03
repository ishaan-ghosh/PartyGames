import type { ReactNode } from "react";

export function Banner({ tone = "info", floating = false, action, children }: {
  tone?: "info" | "warn" | "bad" | "good";
  floating?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={`banner banner-${tone} ${floating ? "banner-floating" : ""}`}>
      <span>{children}</span>
      {action}
    </div>
  );
}
