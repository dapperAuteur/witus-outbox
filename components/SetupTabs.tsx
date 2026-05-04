"use client";

import { useCallback, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";

/**
 * Tabs for /outbox/setup. URL-state-aware: ?tab=common|ocoya|radaar|socialchamp
 * survives reloads + back/forward. Active tab persists across navigations
 * within the page.
 *
 * Each tab gets the components specific to that backend (Ocoya bootstrap
 * + workspace fetcher, RADAAR export, SocialChamp export). The "common"
 * tab holds the cross-backend operator surface — Sync (which now hits
 * every isLive adapter per slice 19c) + the unified Default profiles
 * panel (which already groups by backend).
 */
const TABS = ["common", "ocoya", "radaar", "socialchamp"] as const;
type TabKey = (typeof TABS)[number];

const TAB_LABELS: Record<TabKey, string> = {
  common: "Profiles",
  ocoya: "Ocoya",
  radaar: "RADAAR",
  socialchamp: "SocialChamp",
};

export function SetupTabs(props: {
  common: ReactNode;
  ocoya: ReactNode;
  radaar: ReactNode;
  socialchamp: ReactNode;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const param = (search.get("tab") ?? "common") as string;
  const idx = TABS.indexOf(param as TabKey);
  const selectedIndex = idx >= 0 ? idx : 0;

  const onChange = useCallback(
    (i: number) => {
      const tab: TabKey = TABS[i] ?? "common";
      const sp = new URLSearchParams(search.toString());
      sp.set("tab", tab);
      router.replace(`/outbox/setup?${sp.toString()}`, { scroll: false });
    },
    [router, search]
  );

  return (
    <TabGroup selectedIndex={selectedIndex} onChange={onChange}>
      <TabList
        aria-label="Setup sections"
        className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800"
      >
        {TABS.map((key) => (
          <Tab
            key={key}
            className="data-[selected]:border-violet-600 data-[selected]:text-violet-700 dark:data-[selected]:text-violet-400 inline-flex min-h-11 items-center whitespace-nowrap border-b-2 border-transparent px-4 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 motion-reduce:transition-none dark:text-slate-300 dark:hover:text-slate-50"
          >
            {TAB_LABELS[key]}
          </Tab>
        ))}
      </TabList>
      <TabPanels>
        <TabPanel className="space-y-6">{props.common}</TabPanel>
        <TabPanel className="space-y-6">{props.ocoya}</TabPanel>
        <TabPanel className="space-y-6">{props.radaar}</TabPanel>
        <TabPanel className="space-y-6">{props.socialchamp}</TabPanel>
      </TabPanels>
    </TabGroup>
  );
}
