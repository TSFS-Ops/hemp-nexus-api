import { Outlet } from "react-router-dom";
import { SettingsHeader } from "@/components/desk/settings/SettingsHeader";
import { SettingsTabs } from "@/components/desk/settings/SettingsTabs";

export function DeskSettingsLayout() {
  return (
    <div className="max-w-4xl px-4 md:px-0 pb-20 md:pb-0">
      <SettingsHeader />
      <SettingsTabs />
      <Outlet />
    </div>
  );
}
