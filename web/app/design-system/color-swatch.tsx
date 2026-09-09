function ColorSwatch({ name, className }: { name: string; className: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`h-16 w-full rounded-lg border border-border ${className}`} />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{name}</span>
        <span className="font-mono text-xs text-muted-foreground">--{name}</span>
      </div>
    </div>
  );
}

export { ColorSwatch };
