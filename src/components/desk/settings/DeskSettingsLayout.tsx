import { Outlet } from "react-router-dom";
import { SettingsHeader } from "@/components/desk/settings/SettingsHeader";
import { SettingsTabs } from "@/components/desk/settings/SettingsTabs";

export function DeskSettingsLayout() {
  return (
    <div className="max-w-4xl">
      <SettingsHeader />
      <SettingsTabs />
      <Outlet />
    </div>
  );
}
