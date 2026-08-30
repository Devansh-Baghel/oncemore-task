"use client";

import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@oncemore/ui/components/sidebar";
import { MessageCircleIcon, SettingsIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
	{
		title: "Chat",
		url: "/",
		icon: MessageCircleIcon,
	},
	{
		title: "Config",
		url: "/config",
		icon: SettingsIcon,
	},
] as const;

export function AppSidebar() {
	const pathname = usePathname();

	return (
		<Sidebar collapsible="icon">
			<SidebarHeader className="border-sidebar-border border-b">
				<div className="flex items-center gap-2 px-2 py-1.5">
					<div className="flex size-7 items-center justify-center rounded-none bg-sidebar-primary text-sidebar-primary-foreground">
						<span className="font-semibold text-xs">O</span>
					</div>
					<span className="font-semibold text-sm group-data-[collapsible=icon]:hidden">
						oncemore
					</span>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupLabel>Navigation</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarMenu>
							{NAV_ITEMS.map((item) => {
								const isActive =
									item.url === "/"
										? pathname === "/"
										: pathname.startsWith(item.url);
								return (
									<SidebarMenuItem key={item.title}>
										<SidebarMenuButton
											isActive={isActive}
											tooltip={item.title}
											render={<Link href={item.url} />}
										>
											<item.icon />
											<span>{item.title}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								);
							})}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}
