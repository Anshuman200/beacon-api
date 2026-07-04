"use client";

import { AntdRegistry } from "@ant-design/nextjs-registry";
import { ConfigProvider, App, theme as antdTheme } from "antd";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { useSeederStore } from "@/store/seederStore";
import PwaUpdateManager from "@/components/PwaUpdateManager";

export default function Providers({ children }: { children: ReactNode }) {
  const storeTheme = useSeederStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", storeTheme === "dark");
  }, [storeTheme]);

  const isDark = storeTheme === "dark";
  const algorithm = isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm;

  return (
    <AntdRegistry>
      <ConfigProvider
        theme={{
          algorithm: algorithm,
          token: {
            colorPrimary: isDark ? "#00c2ff" : "#0284c7",
            colorBgContainer: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(255, 255, 255, 0.75)",
            colorBgElevated: isDark ? "#0d1020" : "#ffffff",
            colorBorder: isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(15, 23, 42, 0.08)",
            colorBorderSecondary: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.04)",
            colorText: isDark ? "#e2e8f0" : "#0f172a",
            colorTextPlaceholder: isDark ? "rgba(100, 116, 139, 0.55)" : "rgba(100, 116, 139, 0.45)",
            colorTextSecondary: isDark ? "#94a3b8" : "#475569",
            colorFill: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(15, 23, 42, 0.02)",
            colorFillAlter: isDark ? "rgba(255, 255, 255, 0.02)" : "rgba(15, 23, 42, 0.01)",
            borderRadius: 10,
            borderRadiusLG: 14,
            controlHeight: 38,
            fontFamily: "var(--font-sans)",
            colorSplit: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.04)",
            colorIcon: isDark ? "#64748b" : "#475569",
            colorIconHover: isDark ? "#e2e8f0" : "#0f172a",
          },
          components: {
            Input: {
              activeBorderColor: isDark ? "#00c2ff" : "#0284c7",
              hoverBorderColor: isDark ? "rgba(0, 194, 255, 0.5)" : "rgba(2, 132, 199, 0.5)",
              activeShadow: isDark ? "0 0 0 3px rgba(0, 194, 255, 0.12)" : "0 0 0 3px rgba(2, 132, 199, 0.12)",
              paddingInline: 14,
            },
            InputNumber: {
              activeBorderColor: isDark ? "#00c2ff" : "#0284c7",
              hoverBorderColor: isDark ? "rgba(0, 194, 255, 0.5)" : "rgba(2, 132, 199, 0.5)",
              activeShadow: isDark ? "0 0 0 3px rgba(0, 194, 255, 0.12)" : "0 0 0 3px rgba(2, 132, 199, 0.12)",
              paddingInline: 14,
            },
            Select: {
              optionSelectedBg: isDark ? "rgba(0, 194, 255, 0.15)" : "rgba(2, 132, 199, 0.08)",
              optionActiveBg: isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(15, 23, 42, 0.03)",
            },
            Form: {
              itemMarginBottom: 0,
              labelColor: isDark ? "rgba(255, 255, 255, 0.6)" : "rgba(15, 23, 42, 0.65)",
              labelFontSize: 11,
            },
          },
        }}
      >
        <App style={{ height: "100%" }}>
          {children}
          <PwaUpdateManager />
          <Toaster
            theme={storeTheme}
            position="top-center"
            richColors
            closeButton
            toastOptions={{
              style: {
                borderRadius: 10,
                fontFamily: "var(--font-sans)",
              },
            }}
          />
        </App>
      </ConfigProvider>
    </AntdRegistry>
  );
}
