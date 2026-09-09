"use client";

import { useState } from "react";
import {
  Bell,
  ChevronDown,
  Play,
  Settings,
  Trash2,
  User,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { riskLevelMap, runStatusMap, StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import { ColorSwatch } from "./color-swatch";
import { Section } from "./section";

const runs = [
  { branch: "feat/checkout-validation", sha: "a1c93f2", result: "failed", risk: "high" },
  { branch: "fix/nav-scroll-region", sha: "9e02b17", result: "passed", risk: "low" },
  { branch: "chore/upgrade-deps", sha: "44f7c0a", result: "flaky", risk: "medium" },
  { branch: "feat/onboarding-flow", sha: "0d5e881", result: "skipped", risk: "low" },
] as const;

export default function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-16">
      <header className="flex flex-col gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          /design-system
        </span>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Design System
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Live reference for every token and component in the product. Built on{" "}
          <span className="font-mono text-foreground">shadcn/ui</span> (base-nova
          style) + Tailwind v4. Never hardcode a color or roll a one-off
          component — extend what&apos;s here.
        </p>
      </header>

      <Section
        title="Color"
        description="Base UI tokens (neutral) plus the brand primary and semantic status scale, defined in app/globals.css for both light and dark."
      >
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              Base
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ColorSwatch name="background" className="bg-background" />
              <ColorSwatch name="foreground" className="bg-foreground" />
              <ColorSwatch name="card" className="bg-card" />
              <ColorSwatch name="popover" className="bg-popover" />
              <ColorSwatch name="primary" className="bg-primary" />
              <ColorSwatch name="secondary" className="bg-secondary" />
              <ColorSwatch name="muted" className="bg-muted" />
              <ColorSwatch name="accent" className="bg-accent" />
              <ColorSwatch name="destructive" className="bg-destructive" />
              <ColorSwatch name="border" className="bg-border" />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              Semantic status — success / warning / danger / info
            </h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <ColorSwatch name="success" className="bg-success" />
              <ColorSwatch name="success-muted" className="bg-success-muted" />
              <ColorSwatch name="warning" className="bg-warning" />
              <ColorSwatch name="warning-muted" className="bg-warning-muted" />
              <ColorSwatch name="danger" className="bg-danger" />
              <ColorSwatch name="danger-muted" className="bg-danger-muted" />
              <ColorSwatch name="info" className="bg-info" />
              <ColorSwatch name="info-muted" className="bg-info-muted" />
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              Chart series
            </h3>
            <div className="grid grid-cols-5 gap-4">
              <ColorSwatch name="chart-1" className="bg-chart-1" />
              <ColorSwatch name="chart-2" className="bg-chart-2" />
              <ColorSwatch name="chart-3" className="bg-chart-3" />
              <ColorSwatch name="chart-4" className="bg-chart-4" />
              <ColorSwatch name="chart-5" className="bg-chart-5" />
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Typography"
        description="Geist Sans (default) and Geist Mono (code, SHAs, branch names, trace output)."
      >
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            Heading / text-3xl
          </h1>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Heading / text-2xl
          </h2>
          <h3 className="text-xl font-semibold tracking-tight text-foreground">
            Heading / text-xl
          </h3>
          <h4 className="text-lg font-medium text-foreground">
            Heading / text-lg
          </h4>
          <p className="text-base text-foreground">
            Body / text-base — the quick brown fox jumps over the lazy dog.
          </p>
          <p className="text-sm text-muted-foreground">
            Body muted / text-sm — used for descriptions and secondary text.
          </p>
          <p className="font-mono text-sm text-foreground">
            font-mono / text-sm — a1c93f2 feat/checkout-validation
          </p>
        </div>
      </Section>

      <Section
        title="Radius"
        description="Derived from --radius (0.625rem). Badges/pills use full/4xl, cards and inputs use lg."
      >
        <div className="flex flex-wrap items-end gap-4">
          {(["sm", "md", "lg", "xl", "2xl", "3xl", "4xl"] as const).map((r) => (
            <div key={r} className="flex flex-col items-center gap-2">
              <div className={`size-16 border border-border bg-muted rounded-${r}`} />
              <span className="font-mono text-xs text-muted-foreground">
                rounded-{r}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Buttons" description="components/ui/button.tsx — variant × size.">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Play">
              <Play />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Disabled</Button>
            <Button>
              <Play data-icon="inline-start" />
              Trigger run
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Badges & status"
        description="Plain Badge for labels/counts. StatusBadge (custom, components/ui/status-badge.tsx) for pass/fail/risk states — always go through runStatusMap / riskLevelMap, never a raw color class."
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {Object.entries(runStatusMap).map(([result, status]) => (
              <StatusBadge key={result} status={status}>
                {result}
              </StatusBadge>
            ))}
            {Object.entries(riskLevelMap).map(([risk, status]) => (
              <StatusBadge key={risk} status={status}>
                {risk} risk
              </StatusBadge>
            ))}
          </div>
        </div>
      </Section>

      <Section title="Cards" description="components/ui/card.tsx">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Run summary</CardTitle>
              <CardDescription>feat/checkout-validation @ a1c93f2</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <StatusBadge status="danger">failed</StatusBadge>
              <StatusBadge status="danger">high risk</StatusBadge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Sandbox</CardTitle>
              <CardDescription>Docker · us-east-1</CardDescription>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-3/4" />
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section title="Forms" description="components/ui/input.tsx, label.tsx">
        <div className="grid max-w-sm gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ds-branch">Branch</Label>
            <Input id="ds-branch" placeholder="feat/my-change" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ds-disabled">Disabled</Label>
            <Input id="ds-disabled" disabled placeholder="Not editable" />
          </div>
        </div>
      </Section>

      <Section title="Tabs" description="components/ui/tabs.tsx">
        <Tabs defaultValue="failed" className="max-w-md">
          <TabsList>
            <TabsTrigger value="failed">Failed</TabsTrigger>
            <TabsTrigger value="passed">Passed</TabsTrigger>
            <TabsTrigger value="findings">Additional findings</TabsTrigger>
          </TabsList>
          <TabsContent value="failed" className="text-sm text-muted-foreground">
            1 flow regressed: checkout form validation.
          </TabsContent>
          <TabsContent value="passed" className="text-sm text-muted-foreground">
            12 flows passed against baseline.
          </TabsContent>
          <TabsContent value="findings" className="text-sm text-muted-foreground">
            No additional findings this run.
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Table" description="components/ui/table.tsx">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Branch</TableHead>
              <TableHead>SHA</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => (
              <TableRow key={run.branch}>
                <TableCell className="font-mono text-sm">{run.branch}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {run.sha}
                </TableCell>
                <TableCell>
                  <StatusBadge status={riskLevelMap[run.risk]}>{run.risk}</StatusBadge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={runStatusMap[run.result]}>{run.result}</StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section
        title="Overlays"
        description="components/ui/dialog.tsx, dropdown-menu.tsx, tooltip.tsx"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button variant="outline" />}>
              <Trash2 data-icon="inline-start" />
              Delete run
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete this run?</DialogTitle>
                <DialogDescription>
                  This removes the forensic artifacts (trace, video, DOM snapshot)
                  for feat/checkout-validation @ a1c93f2. This can&apos;t be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={() => setDialogOpen(false)}>
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>
              Actions
              <ChevronDown data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Run actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <Play data-icon="inline-start" />
                  Re-run
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <Settings data-icon="inline-start" />
                  Configure
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon" aria-label="Notifications" />}
            >
              <Bell />
            </TooltipTrigger>
            <TooltipContent>Notify on new failures</TooltipContent>
          </Tooltip>
        </div>
      </Section>

      <Section title="Avatar" description="components/ui/avatar.tsx">
        <div className="flex items-center gap-6">
          <Avatar>
            <AvatarFallback>
              <User className="size-4" />
            </AvatarFallback>
          </Avatar>
          <AvatarGroup>
            <Avatar>
              <AvatarFallback>HP</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>JD</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>AK</AvatarFallback>
            </Avatar>
            <AvatarGroupCount>+3</AvatarGroupCount>
          </AvatarGroup>
        </div>
      </Section>

      <Section title="Loading" description="components/ui/skeleton.tsx">
        <div className="flex max-w-sm flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Section>

      <Separator />
      <p className="pb-4 text-xs text-muted-foreground">
        Full written reference: <span className="font-mono">web/DESIGN_SYSTEM.md</span>
      </p>
    </div>
  );
}
