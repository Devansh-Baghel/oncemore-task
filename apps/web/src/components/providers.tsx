"use client";

import { Toaster } from "@oncemore/ui/components/sonner";
import { TooltipProvider } from "@oncemore/ui/components/tooltip";

import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="system"
			enableSystem
			disableTransitionOnChange
		>
			<TooltipProvider>{children}</TooltipProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}
