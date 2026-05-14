export function SettingsHeader() {
  return (
    <header className="mb-8 md:mb-10">
      <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground/70 mb-3">
        Account
      </p>
      <h1 className="text-2xl md:text-4xl font-semibold text-foreground tracking-tight">
        Settings &amp; Identity
      </h1>
      <p className="mt-3 md:mt-4 text-sm md:text-base text-muted-foreground leading-relaxed max-w-xl">
        Manage your profile, company verification status, notification preferences, and credit balance.
      </p>
    </header>
  );
}
